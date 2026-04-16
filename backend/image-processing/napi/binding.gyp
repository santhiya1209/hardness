{
  "targets": [
    {
      "target_name": "processor",
      "sources": ["processor.cpp"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
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
          "AdditionalOptions":        ["/std:c++17", "/arch:AVX2", "/fp:fast"],
          "ExceptionHandling":         1,
          "Optimization":              "2",
          "EnableIntrinsicFunctions":  "true",
          "FavorSizeOrSpeed":          "2",
          "StringPooling":             "true"
        },
        "VCLinkerTool": {
          "GenerateDebugInformation": "false"
        }
      }
    }
  ]
}
