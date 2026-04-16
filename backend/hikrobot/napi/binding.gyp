{
  "targets": [
    {
      "target_name": "stream",
      "sources": ["stream.cpp"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "C:/Program Files (x86)/MVS/Development/Includes"
      ],
      "libraries": [
        "C:/Program Files (x86)/MVS/Development/Libraries/win64/MvCameraControl.lib"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NODE_ADDON_API_DISABLE_NODE_DEPRECATED",
        "_USE_MATH_DEFINES"
      ],
      "cflags!":    ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions":        ["/std:c++17"],
          "ExceptionHandling":         1,
          "Optimization":              "2",
          "EnableIntrinsicFunctions":  "true",
          "FavorSizeOrSpeed":          "2"
        },
        "VCLinkerTool": {
          "GenerateDebugInformation": "false"
        }
      },
      "copies": [
        {
          "destination": "<(PRODUCT_DIR)",
          "files": [
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/MvCameraControl.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/MvCameraControlWrapper.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/MvUsb3vTL.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/MvProducerU3V.cti",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/libusb0.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/FormatConversion.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/MVMemAlloc.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/MvISPControl.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/MvRender.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/MediaProcess.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/GCBase_MD_VC120_v3_0_MV.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/GenApi_MD_VC120_v3_0_MV.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/Log_MD_VC120_v3_0_MV.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/MathParser_MD_VC120_v3_0_MV.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/NodeMapData_MD_VC120_v3_0_MV.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/XmlParser_MD_VC120_v3_0_MV.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/CLAllSerial_MD_VC120_v3_0_MV.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/CLProtocol_MD_VC120_v3_0_MV.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/log4cpp_MD_VC120_v3_0_MV.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/MvSDKVersion.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/MvCameraPatch.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/pthreadVC2.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/msvcp120.dll",
            "C:/Program Files (x86)/Common Files/MVS/Runtime/Win64_x64/msvcr120.dll"
          ]
        }
      ]
    }
  ]
}
