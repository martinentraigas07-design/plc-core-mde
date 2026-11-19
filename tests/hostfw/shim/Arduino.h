#pragma once
#include <cstdio>
#include <cstdarg>
#include <cstdint>
#include <algorithm>
#include "WString.h"
using std::min; using std::max;
#define constrain(amt,low,high) ((amt)<(low)?(low):((amt)>(high)?(high):(amt)))
extern unsigned long g_millis;
inline unsigned long millis(){ return g_millis; }
#include <cstdarg>
#include <cstdio>
struct SerialT { void printf(const char* f, ...){ va_list a; va_start(a,f); vfprintf(stderr,f,a); va_end(a);} void println(const char* s){ fprintf(stderr,"%s\n",s);} } ;
extern SerialT Serial;
