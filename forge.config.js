const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

module.exports = {
  packagerConfig: {
    asar: {
      unpack: "*.{node,dll,cti,dylib,so,exe,pyd,inf,sys,cat}",
    },

    // ✅ App Name (EXE)
    name: "HardnessTester",
    executableName: "HardnessTester",

    prune: true,

    ignore: [
      /^\/frontend\/src/,
      /^\/frontend\/node_modules/,
      /^\/frontend\/.*\.config\..*/,
      /^\/frontend\/tsconfig\.json/,
      /^\/frontend\/package-lock\.json/,
      /^\/frontend\/.*\.html/,
      /^\/backend\/src/,
      /^\/backend\/tsconfig\.json/,
      /^\/backend\/.env.*/,
      /^\/\.git/,
      /^\/\.vscode/,
      /^\/README\.md$/,
      /^\/\.gitignore$/,
      /^\/\.env$/,
      /^\/tsconfig\.json$/,
      /^\/package-lock\.json$/,
      /\.py$/,
      /\.sql$/,
      /\.(c|cpp|h|o|obj|lib|exp|iobj|ipdb|pdb|sln|vcxproj|filters|user)$/,
      /\.map$/,
    ],

    extraResources: [],
  },

  rebuildConfig: {},

  makers: [
    {
      name: "@electron-addons/electron-forge-maker-nsis",
      config: {
        // ✅ Unique App ID
        appId: "com.hardness.tester",

        // ✅ Display Name
        productName: "Hardness Tester",

        win: {
          target: ["nsis"],
        },

        nsis: {
          oneClick: false,
          perMachine: true,
          allowElevation: true,
          allowToChangeInstallationDirectory: true,

          createDesktopShortcut: true,
          createStartMenuShortcut: true,

          // ✅ Shortcut name
          shortcutName: "Hardness Tester",

          // ✅ Installer EXE name
          artifactName: "HardnessTester-Setup.exe",

          // ✅ Icons
          installerIcon: "frontend/public/icon.ico",
          uninstallerIcon: "frontend/public/icon.ico",

          // ✅ License file (optional)
          license: "LICENSE.txt",
        },
      },
    },
  ],

  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },

    new FusesPlugin({
      version: FuseVersion.V1,

      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};