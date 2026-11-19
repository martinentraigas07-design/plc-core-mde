#pragma once
#include <string>
#include <cstdlib>
#include <cstring>
class String {
 public:
  std::string s;
  String() {}
  String(const char* c) : s(c ? c : "") {}
  String(const std::string& c) : s(c) {}
  String(const String& o) : s(o.s) {}
  String& operator=(const String& o){ s=o.s; return *this; }
  String& operator=(const char* c){ s = c?c:""; return *this; }
  const char* c_str() const { return s.c_str(); }
  unsigned int length() const { return (unsigned)s.size(); }
  long toInt() const { return strtol(s.c_str(), nullptr, 10); }
  unsigned char concat(const char* c){ s.append(c); return 1; }
  unsigned char concat(const char* c, unsigned n){ s.append(c,n); return 1; }
  unsigned char concat(char c){ s.push_back(c); return 1; }
  void reserve(unsigned n){ s.reserve(n); }
  String& operator+=(const String& o){ s+=o.s; return *this; }
  bool operator==(const String& o) const { return s==o.s; }
  bool operator==(const char* c) const { return s==c; }
  bool operator!=(const char* c) const { return s!=c; }
  bool operator!=(const String& o) const { return s!=o.s; }
  char operator[](unsigned i) const { return s[i]; }
};
