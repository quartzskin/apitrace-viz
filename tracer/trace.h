#pragma once
#include <windows.h>
#include <tlhelp32.h>

#include <cstdint>
#include <cstdio>
#include <mutex>
#include <string>
#include <type_traits>

namespace trace {

inline std::string escape(const std::string& s) {
    std::string out;
    for (unsigned char c : s) {
        switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (c < 0x20) {
                char buf[8];
                std::snprintf(buf, sizeof buf, "\\u%04x", c);
                out += buf;
            } else {
                out += static_cast<char>(c);
            }
        }
    }
    return out;
}

class Args {
public:
    Args& s(const char* key, const std::string& v) {
        sep();
        body_ += "\"" + std::string(key) + "\":\"" + escape(v) + "\"";
        return *this;
    }
    Args& n(const char* key, long long v) {
        sep();
        body_ += "\"" + std::string(key) + "\":" + std::to_string(v);
        return *this;
    }
    std::string json() const { return "{" + body_ + "}"; }

private:
    void sep() {
        if (!body_.empty()) body_ += ',';
    }
    std::string body_;
};

class Tracer {
public:
    static Tracer& get() {
        static Tracer t;
        return t;
    }

    // Appends, so a child process can share the parent's file.
    bool open(const char* path) {
        file_ = CreateFileA(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                            OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        pid_ = GetCurrentProcessId();
        ppid_ = findParent(pid_);
        QueryPerformanceFrequency(&freq_);
        return file_ != INVALID_HANDLE_VALUE;
    }

    static std::string hex(uintptr_t v) {
        char buf[24];
        std::snprintf(buf, sizeof buf, "0x%llx", static_cast<unsigned long long>(v));
        return buf;
    }

    template <class F>
    auto call(const char* api, const char* cat, const Args& args, F&& f) {
        long long ts = nowMicros();
        LARGE_INTEGER a, b;
        SetLastError(0);
        QueryPerformanceCounter(&a);
        auto r = f();
        QueryPerformanceCounter(&b);
        DWORD err = GetLastError();
        long long dur = (b.QuadPart - a.QuadPart) * 1000000 / freq_.QuadPart;
        emit(ts, dur, api, cat, args.json(), retJson(r), err);
        SetLastError(err);
        return r;
    }

private:
    Tracer() = default;

    template <class T>
    static std::string retJson(const T& r) {
        if constexpr (std::is_pointer_v<T>) {
            return "\"" + hex(reinterpret_cast<uintptr_t>(r)) + "\"";
        } else {
            return std::to_string(static_cast<long long>(r));
        }
    }

    static long long nowMicros() {
        FILETIME ft;
        GetSystemTimePreciseAsFileTime(&ft);
        ULARGE_INTEGER u;
        u.LowPart = ft.dwLowDateTime;
        u.HighPart = ft.dwHighDateTime;
        // FILETIME is 100ns ticks since 1601
        return static_cast<long long>(u.QuadPart / 10 - 11644473600000000ULL);
    }

    static DWORD findParent(DWORD pid) {
        HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap == INVALID_HANDLE_VALUE) return 0;
        PROCESSENTRY32 pe;
        pe.dwSize = sizeof pe;
        DWORD parent = 0;
        for (BOOL ok = Process32First(snap, &pe); ok; ok = Process32Next(snap, &pe)) {
            if (pe.th32ProcessID == pid) {
                parent = pe.th32ParentProcessID;
                break;
            }
        }
        CloseHandle(snap);
        return parent;
    }

    void emit(long long ts, long long dur, const char* api, const char* cat,
              const std::string& args, const std::string& ret, DWORD err) {
        std::string line = "{\"ts\":" + std::to_string(ts) + ",\"pid\":" + std::to_string(pid_) +
                           ",\"ppid\":" + std::to_string(ppid_) +
                           ",\"tid\":" + std::to_string(GetCurrentThreadId()) + ",\"api\":\"" + api +
                           "\",\"cat\":\"" + cat + "\",\"args\":" + args + ",\"ret\":" + ret +
                           ",\"err\":" + std::to_string(err) +
                           ",\"dur_us\":" + std::to_string(dur) + "}\n";
        std::lock_guard<std::mutex> lock(mu_);
        if (file_ == INVALID_HANDLE_VALUE) return;
        DWORD written = 0;
        WriteFile(file_, line.data(), static_cast<DWORD>(line.size()), &written, nullptr);
    }

    HANDLE file_ = INVALID_HANDLE_VALUE;
    DWORD pid_ = 0, ppid_ = 0;
    LARGE_INTEGER freq_{};
    std::mutex mu_;
};

}  // namespace trace
