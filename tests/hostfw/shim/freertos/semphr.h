#pragma once
inline void* xSemaphoreCreateMutex(){ static int x; return &x; }
inline int xSemaphoreTake(void*, int){ return 1; }
inline void xSemaphoreGive(void*){}
