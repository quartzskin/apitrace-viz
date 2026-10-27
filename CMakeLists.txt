cmake_minimum_required(VERSION 3.16)
project(apitrace_viz CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT WIN32)
  message(FATAL_ERROR "the toy program only builds on Windows")
endif()

add_executable(toy tracer/toy.cpp tracer/trace.h)
if(MSVC)
  target_compile_options(toy PRIVATE /W4)
else()
  target_compile_options(toy PRIVATE -Wall -Wextra)
  target_link_options(toy PRIVATE -static)
endif()
