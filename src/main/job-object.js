'use strict';

/**
 * Windows Job Object 로 자식 프로세스를 묶는다.
 *
 * KILL_ON_JOB_CLOSE 플래그를 걸어 두면, 우리 프로세스가 어떤 식으로 죽든
 * (작업 관리자 강제 종료, 크래시 포함) 커널이 job에 속한 자식을 같이 정리한다.
 * PID 기록 방식은 정상 종료 경로만 커버하므로, 그 위의 안전망 역할이다.
 *
 * 실패해도 앱 동작에는 영향이 없어야 한다 — 그때는 PID 추적만으로 동작한다.
 */

const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
const JobObjectExtendedLimitInformation = 9;

// x64 기준 JOBOBJECT_EXTENDED_LIMIT_INFORMATION 크기와 LimitFlags 위치.
// BasicLimitInformation 안의 LimitFlags 는 구조체 선두에서 16바이트 지점.
const EXTENDED_LIMIT_SIZE = 144;
const LIMIT_FLAGS_OFFSET = 16;

const PROCESS_TERMINATE = 0x0001;
const PROCESS_SET_QUOTA = 0x0100;

let api = null;
let jobHandle = null;
let failure = null;

function init() {
  if (api || failure) return Boolean(api);
  if (process.platform !== 'win32') {
    failure = 'win32 전용';
    return false;
  }

  try {
    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');

    api = {
      koffi,
      CreateJobObjectW: kernel32.func('void* __stdcall CreateJobObjectW(void*, const char16_t*)'),
      AssignProcessToJobObject: kernel32.func('bool __stdcall AssignProcessToJobObject(void*, void*)'),
      SetInformationJobObject: kernel32.func(
        'bool __stdcall SetInformationJobObject(void*, int, void*, uint32_t)'
      ),
      OpenProcess: kernel32.func('void* __stdcall OpenProcess(uint32_t, bool, uint32_t)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void*)'),
    };
    return true;
  } catch (err) {
    failure = String(err?.message || err);
    api = null;
    return false;
  }
}

/** 프로세스당 한 번. 성공하면 true. */
function create() {
  if (jobHandle) return true;
  if (!init()) return false;

  try {
    const handle = api.CreateJobObjectW(null, null);
    if (!handle) {
      failure = 'CreateJobObjectW 실패';
      return false;
    }

    // 구조체 전체를 0으로 두고 LimitFlags 만 세운다.
    const info = Buffer.alloc(EXTENDED_LIMIT_SIZE);
    info.writeUInt32LE(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, LIMIT_FLAGS_OFFSET);

    const ok = api.SetInformationJobObject(
      handle,
      JobObjectExtendedLimitInformation,
      info,
      EXTENDED_LIMIT_SIZE
    );
    if (!ok) {
      api.CloseHandle(handle);
      failure = 'SetInformationJobObject 실패';
      return false;
    }

    jobHandle = handle;
    return true;
  } catch (err) {
    failure = String(err?.message || err);
    return false;
  }
}

/** 자식 PID를 job에 넣는다. 실패해도 조용히 false. */
function assign(pid) {
  if (!jobHandle && !create()) return false;

  let processHandle = null;
  try {
    processHandle = api.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid);
    if (!processHandle) return false;
    return Boolean(api.AssignProcessToJobObject(jobHandle, processHandle));
  } catch {
    return false;
  } finally {
    if (processHandle) {
      try {
        api.CloseHandle(processHandle);
      } catch {
        /* 무시 */
      }
    }
  }
}

function status() {
  return { available: Boolean(jobHandle), failure };
}

module.exports = { create, assign, status };
