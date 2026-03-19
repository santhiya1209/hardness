const { default: MakerSquirrel } = require("@electron-forge/maker-squirrel");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

module.exports = {
  packagerConfig: {
    asar: {
      unpack: "*.{node,dll,cti,dylib,so,exe,pyd,inf,sys,cat}",
    },
    name: 'weldmet',
    executableName: 'weldmet',
    prune: true,
    ignore: [
      /^\/client\/src/,
      /^\/client\/node_modules/,
      /^\/client\/.*\.config\..*/, // vite.config, tailwind.config, etc.
      /^\/client\/tsconfig\.json/,
      /^\/client\/package\.json/,
      /^\/client\/package-lock\.json/,
      /^\/client\/.*\.html/, // index.html in root of client (if dist has its own)
      /^\/backend\/src/, // Backend source is not needed if using dist
      /^\/backend\/tsconfig\.json/,
      /^\/backend\/.env.*/, // Env files shouldn't be shipped usually, or handled carefully
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
      /\.map$/
    ],
    extraResources: []
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-addons/electron-forge-maker-nsis',
      config: {
        appId: 'com.chennaimetco.weldmet',
        productName: 'weldmet',
        win: {
          target: ['nsis']
        },
        nsis: {
          oneClick: false,  // wizard with Next/Back
          perMachine: true,
          allowElevation: true,
          allowToChangeInstallationDirectory: true,
          include: 'build/installer.nsh',  // Custom script for driver installation
          createDesktopShortcut: true,
          createStartMenuShortcut: true,
          shortcutName: 'Weldmet',
          artifactName: 'Weldmet-Setup.exe',
          installerIcon: 'client/public/weldmet.ico',
          uninstallerIcon: 'client/public/weldmet.ico',
          license: 'LICENSE.txt'
        }
      }
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
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