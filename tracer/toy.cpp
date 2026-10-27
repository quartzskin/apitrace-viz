#include <cstring>
#include <string>

#include "trace.h"

using trace::Args;
using trace::Tracer;

#define TRACED(api, cat, args, expr) Tracer::get().call(api, cat, args, [&] { return expr; })

static const char* kWorkDir = "toy-work";

static DWORD WINAPI worker(LPVOID) {
    std::string path = std::string(kWorkDir) + "\\worker.log";
    HANDLE h = TRACED("CreateFileA", "file",
                      Args().s("path", path).s("access", "GENERIC_WRITE").s("disposition", "CREATE_ALWAYS"),
                      CreateFileA(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                                  FILE_ATTRIBUTE_NORMAL, nullptr));
    if (h == INVALID_HANDLE_VALUE) return 1;
    for (int i = 0; i < 3; i++) {
        std::string msg = "worker tick " + std::to_string(i) + "\r\n";
        DWORD n = 0;
        TRACED("WriteFile", "file", Args().n("bytes", (long long)msg.size()),
               WriteFile(h, msg.data(), (DWORD)msg.size(), &n, nullptr));
        TRACED("Sleep", "time", Args().n("ms", 15), (Sleep(15), 0));
    }
    TRACED("CloseHandle", "file", Args(), CloseHandle(h));
    return 0;
}

static void fileWork() {
    TRACED("CreateDirectoryA", "file", Args().s("path", kWorkDir), CreateDirectoryA(kWorkDir, nullptr));

    std::string path = std::string(kWorkDir) + "\\data.bin";
    HANDLE h = TRACED("CreateFileA", "file",
                      Args().s("path", path).s("access", "GENERIC_READ|GENERIC_WRITE").s("disposition", "CREATE_ALWAYS"),
                      CreateFileA(path.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                                  FILE_ATTRIBUTE_NORMAL, nullptr));
    if (h == INVALID_HANDLE_VALUE) return;

    char block[256];
    for (int i = 0; i < 256; i++) block[i] = (char)i;
    for (int i = 0; i < 4; i++) {
        DWORD n = 0;
        TRACED("WriteFile", "file", Args().n("bytes", sizeof block),
               WriteFile(h, block, sizeof block, &n, nullptr));
    }
    TRACED("FlushFileBuffers", "file", Args(), FlushFileBuffers(h));
    TRACED("SetFilePointer", "file", Args().n("offset", 0).s("method", "FILE_BEGIN"),
           SetFilePointer(h, 0, nullptr, FILE_BEGIN));
    TRACED("GetFileSize", "file", Args(), GetFileSize(h, nullptr));

    char buf[512];
    DWORD got = 0;
    TRACED("ReadFile", "file", Args().n("requested", sizeof buf),
           ReadFile(h, buf, sizeof buf, &got, nullptr));
    TRACED("CloseHandle", "file", Args(), CloseHandle(h));

    std::string missing = std::string(kWorkDir) + "\\does-not-exist.txt";
    TRACED("CreateFileA", "file",
           Args().s("path", missing).s("access", "GENERIC_READ").s("disposition", "OPEN_EXISTING"),
           CreateFileA(missing.c_str(), GENERIC_READ, 0, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL,
                       nullptr));
}

static void registryWork() {
    const char* sub = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
    HKEY key = nullptr;
    LONG rc = TRACED("RegOpenKeyExA", "registry", Args().s("key", std::string("HKLM\\") + sub).s("access", "KEY_READ"),
                     RegOpenKeyExA(HKEY_LOCAL_MACHINE, sub, 0, KEY_READ, &key));
    if (rc != ERROR_SUCCESS) return;

    char value[128];
    DWORD size = sizeof value, type = 0;
    TRACED("RegQueryValueExA", "registry", Args().s("value", "ProductName"),
           RegQueryValueExA(key, "ProductName", nullptr, &type, (LPBYTE)value, &size));
    size = sizeof value;
    TRACED("RegQueryValueExA", "registry", Args().s("value", "NoSuchValue"),
           RegQueryValueExA(key, "NoSuchValue", nullptr, &type, (LPBYTE)value, &size));
    TRACED("RegCloseKey", "registry", Args(), RegCloseKey(key));
}

static void systemInfo() {
    char name[MAX_PATH];
    DWORD n = TRACED("GetModuleFileNameA", "system", Args(), GetModuleFileNameA(nullptr, name, MAX_PATH));
    TRACED("GetCurrentProcessId", "process", Args(), GetCurrentProcessId());
    TRACED("GetTickCount64", "time", Args(), GetTickCount64());
    SYSTEM_INFO si;
    TRACED("GetSystemInfo", "system", Args(), (GetSystemInfo(&si), (int)si.dwNumberOfProcessors));
    char env[64];
    TRACED("GetEnvironmentVariableA", "system", Args().s("name", "NUMBER_OF_PROCESSORS"),
           GetEnvironmentVariableA("NUMBER_OF_PROCESSORS", env, sizeof env));
    (void)n;
}

static void memoryWork() {
    void* p = TRACED("VirtualAlloc", "memory", Args().n("size", 65536).s("protect", "PAGE_READWRITE"),
                     VirtualAlloc(nullptr, 65536, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE));
    if (p) {
        memset(p, 0xAB, 65536);
        TRACED("VirtualFree", "memory", Args().s("type", "MEM_RELEASE"), VirtualFree(p, 0, MEM_RELEASE));
    }
}

static void threadWork() {
    HANDLE t = TRACED("CreateThread", "thread", Args().s("start", "worker"),
                      CreateThread(nullptr, 0, worker, nullptr, 0, nullptr));
    if (!t) return;
    TRACED("Sleep", "time", Args().n("ms", 20), (Sleep(20), 0));
    TRACED("WaitForSingleObject", "thread", Args().s("target", "worker thread").n("timeout_ms", 2000),
           WaitForSingleObject(t, 2000));
    TRACED("CloseHandle", "thread", Args(), CloseHandle(t));
}

static void spawnChild(const char* self, const char* tracePath) {
    std::string cmd = std::string("\"") + self + "\" --child " + tracePath;
    STARTUPINFOA si{};
    si.cb = sizeof si;
    PROCESS_INFORMATION pi{};
    BOOL ok = TRACED("CreateProcessA", "process", Args().s("cmdline", "toy.exe --child"),
                     CreateProcessA(nullptr, &cmd[0], nullptr, nullptr, FALSE, 0, nullptr, nullptr, &si, &pi));
    if (!ok) return;
    TRACED("WaitForSingleObject", "process", Args().s("target", "child process").n("timeout_ms", 5000),
           WaitForSingleObject(pi.hProcess, 5000));
    DWORD code = 0;
    TRACED("GetExitCodeProcess", "process", Args(), GetExitCodeProcess(pi.hProcess, &code));
    TRACED("CloseHandle", "process", Args(), CloseHandle(pi.hProcess));
    TRACED("CloseHandle", "process", Args(), CloseHandle(pi.hThread));
}

static void cleanup() {
    std::string files[] = {"data.bin", "worker.log", "child.txt"};
    for (auto& f : files) {
        std::string p = std::string(kWorkDir) + "\\" + f;
        TRACED("DeleteFileA", "file", Args().s("path", p), DeleteFileA(p.c_str()));
    }
    TRACED("RemoveDirectoryA", "file", Args().s("path", kWorkDir), RemoveDirectoryA(kWorkDir));
}

static int runChild() {
    std::string path = std::string(kWorkDir) + "\\child.txt";
    HANDLE h = TRACED("CreateFileA", "file",
                      Args().s("path", path).s("access", "GENERIC_WRITE").s("disposition", "CREATE_ALWAYS"),
                      CreateFileA(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                                  FILE_ATTRIBUTE_NORMAL, nullptr));
    if (h == INVALID_HANDLE_VALUE) return 1;
    const char msg[] = "hello from the child\r\n";
    DWORD n = 0;
    TRACED("WriteFile", "file", Args().n("bytes", sizeof msg - 1),
           WriteFile(h, msg, sizeof msg - 1, &n, nullptr));
    TRACED("CloseHandle", "file", Args(), CloseHandle(h));
    TRACED("Sleep", "time", Args().n("ms", 10), (Sleep(10), 0));
    return 0;
}

int main(int argc, char** argv) {
    bool child = argc > 1 && std::strcmp(argv[1], "--child") == 0;
    const char* tracePath = argc > (child ? 2 : 1) ? argv[child ? 2 : 1] : "trace.jsonl";

    if (!Tracer::get().open(tracePath)) {
        std::fprintf(stderr, "cannot open %s\n", tracePath);
        return 2;
    }
    if (child) return runChild();

    systemInfo();
    fileWork();
    registryWork();
    memoryWork();
    threadWork();
    TRACED("Sleep", "time", Args().n("ms", 25), (Sleep(25), 0));
    spawnChild(argv[0], tracePath);
    cleanup();
    return 0;
}
