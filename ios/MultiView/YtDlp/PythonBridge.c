#include "PythonBridge.h"

#include <Python/Python.h>
#include <stdlib.h>
#include <string.h>

static char *mv_copy(const char *text) {
    return strdup(text ? text : "");
}

/// 取出目前的 Python 例外，轉成文字並清除。要在持有 GIL 時呼叫。
static char *mv_take_error(void) {
    PyObject *exception = PyErr_GetRaisedException();
    if (exception == NULL) {
        return mv_copy("未知的 Python 錯誤");
    }
    PyObject *text = PyObject_Repr(exception);
    const char *utf8 = text ? PyUnicode_AsUTF8(text) : NULL;
    char *message = mv_copy(utf8 ? utf8 : "無法讀取 Python 的錯誤訊息");
    Py_XDECREF(text);
    Py_DECREF(exception);
    PyErr_Clear();
    return message;
}

char *mv_python_start(const char *home, const char *search_paths) {
    if (Py_IsInitialized()) {
        return NULL;
    }

    PyConfig config;
    // 不讀環境變數、不讀使用者的設定：只用 App 裡附的 Python
    PyConfig_InitIsolatedConfig(&config);
    config.install_signal_handlers = 0;
    // App 的資料夾不能寫入，不產生 .pyc
    config.write_bytecode = 0;

    PyStatus status = PyConfig_SetBytesString(&config, &config.home, home);
    if (!PyStatus_Exception(status)) {
        status = Py_InitializeFromConfig(&config);
    }
    PyConfig_Clear(&config);
    if (PyStatus_Exception(status)) {
        return mv_copy(status.err_msg ? status.err_msg : "Python 啟動失敗");
    }

    // 把 App 的 Python 程式與套件加到 sys.path 最前面
    char *error = NULL;
    PyObject *sys_path = PySys_GetObject("path"); // 借用的參考
    char *paths = mv_copy(search_paths);
    Py_ssize_t position = 0;
    for (char *path = strtok(paths, "\n"); path != NULL && sys_path != NULL; path = strtok(NULL, "\n")) {
        PyObject *item = PyUnicode_FromString(path);
        if (item == NULL || PyList_Insert(sys_path, position, item) != 0) {
            Py_XDECREF(item);
            error = mv_take_error();
            break;
        }
        Py_DECREF(item);
        position += 1;
    }
    free(paths);

    // 放開 GIL：之後每次呼叫都用 PyGILState_Ensure 取得
    PyEval_SaveThread();
    return error;
}

char *mv_python_install_js(void *eval_function, void *free_function) {
    PyGILState_STATE state = PyGILState_Ensure();
    char *error = NULL;
    PyObject *module = PyImport_ImportModule("mv_bridge");
    PyObject *result = NULL;
    if (module != NULL) {
        result = PyObject_CallMethod(
            module, "install", "KK",
            (unsigned long long)(uintptr_t)eval_function,
            (unsigned long long)(uintptr_t)free_function);
    }
    if (result == NULL) {
        error = mv_take_error();
    }
    Py_XDECREF(result);
    Py_XDECREF(module);
    PyGILState_Release(state);
    return error;
}

char *mv_python_call(const char *module_name, const char *function_name, const char *argument, int *ok) {
    PyGILState_STATE state = PyGILState_Ensure();
    char *output = NULL;
    *ok = 0;

    PyObject *module = PyImport_ImportModule(module_name);
    if (module != NULL) {
        PyObject *result = PyObject_CallMethod(module, function_name, "s", argument);
        if (result != NULL) {
            const char *utf8 = PyUnicode_AsUTF8(result);
            if (utf8 != NULL) {
                output = mv_copy(utf8);
                *ok = 1;
            }
            Py_DECREF(result);
        }
        Py_DECREF(module);
    }
    if (output == NULL) {
        output = mv_take_error();
    }

    PyGILState_Release(state);
    return output;
}
