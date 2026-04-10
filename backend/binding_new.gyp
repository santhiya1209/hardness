{
  "targets": [
    {
      "target_name": "hikrobot_camera_new",
      "sources": [
        "native/hikrobot/hikrobot_camera.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "C:/Program Files (x86)/MVS/Development/Includes",
        "native/hikrobot"
      ],
      "libraries": [
        "C:/Program Files (x86)/MVS/Development/Libraries/win64/MvCameraControl.lib"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NODE_ADDON_API_DISABLE_NODE_DEPRECATED",
        "_USE_MATH_DEFINES"
      ],
      "cflags!":    [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": [ "/std:c++17" ],
          "DebugInformationFormat": "0",
          "WholeProgramOptimization": "false",
          "Optimization": "0"
        },
        "VCLinkerTool": {
          "GenerateDebugInformation": "false"
        }
      }
    }
  ]
}
