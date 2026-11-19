#include <ArduinoJson.h>
#include <fstream>
#include <sstream>
#include <iostream>
int main(int argc,char**argv){
  std::ifstream f(argv[1]); std::stringstream ss; ss<<f.rdbuf(); std::string js=ss.str();
  size_t cap = 400000;
  { DynamicJsonDocument d(cap); auto e=deserializeJson(d,js); printf("full=%u err=%s ",(unsigned)d.memoryUsage(),e.c_str()); }
  { StaticJsonDocument<384> filter; JsonObject fn=filter["drawflow"]["Home"]["data"].createNestedObject("*");
    fn["id"]=true; fn["name"]=true; fn["data"]=true; fn["outputs"]["*"]["connections"]=true;
    DynamicJsonDocument d(cap); auto e=deserializeJson(d,js,DeserializationOption::Filter(filter)); printf("filtered=%u err=%s\n",(unsigned)d.memoryUsage(),e.c_str()); }
}
