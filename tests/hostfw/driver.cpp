// Host driver: compila plc_runtime.cpp (SIN modificar) contra stubs de Arduino.

#include <ArduinoJson.h>
#include "Arduino.h"
#include "plc_runtime.h"
#include "plc_io.h"
#include "plc_state.h"
#include <iostream>
#include <fstream>
#include <sstream>
unsigned long g_millis = 1000;
SerialT Serial;
PLC_MODE plcMode = PLC_RUN;
static bool gIn[2]={0,0}; static int gAi[1]={0}; static bool gOut[4]={0}; static int gPwm[4]={0};
bool plcReadInput(int n){ return gIn[n]; }
int plcReadAnalog(int n){ return gAi[n]; }
void plcWriteOutput(int n,bool s){ gOut[n]=s; }
void plcRegisterPWM(int){} void plcMarkPinAsPWM(int){}
void plcWritePWM(int i,int v){ gPwm[i]=v; }
int main(int argc,char**argv){
  std::ifstream f(argv[1]); std::stringstream ss; ss<<f.rdbuf();
  parseProgram(String(ss.str()));
  std::string cmd;
  while(std::cin>>cmd){
    if(cmd=="in"){int i,v;std::cin>>i>>v;gIn[i]=v;}
    else if(cmd=="ai"){int i,v;std::cin>>i>>v;gAi[i]=v;}
    else if(cmd=="scan"){int n;std::cin>>n;while(n--){plcScan();g_millis+=10;}}
    else if(cmd=="adv"){unsigned long ms;std::cin>>ms;g_millis+=ms;}
    else if(cmd=="print"){
      printf("OUT %d %d %d %d PWM %d %d %d %d\n",gOut[0],gOut[1],gOut[2],gOut[3],gPwm[0],gPwm[1],gPwm[2],gPwm[3]);
      fflush(stdout);
    }
    else if(cmd=="reload"){std::string fn;std::cin>>fn;std::ifstream g(fn);std::stringstream s2;s2<<g.rdbuf();parseProgram(String(s2.str()));}
    else if(cmd=="count"){printf("COUNT %d %d\n",nodeCount,execCount);fflush(stdout);}
    else if(cmd=="order"){for(int e=0;e<execCount;e++)printf("%d ",nodes[execOrder[e]].id);printf("\n");fflush(stdout);}
    else if(cmd=="node"){int id;std::cin>>id;for(int i=0;i<nodeCount;i++)if(nodes[i].id==id)printf("NODE %d %s state=%d int=%d\n",id,nodes[i].name.c_str(),nodes[i].state,nodes[i].intValue);fflush(stdout);}
  }
}
