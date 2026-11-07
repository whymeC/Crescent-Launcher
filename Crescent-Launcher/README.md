# Crescent launcher

A desktop launcher that finds the games installed on your PC and lets you play all of them from one place.
Built with Electron, packaged with electron-builder, updated through GitHub Releases.

## What it detects

| Source | How | Notes |
| --- | --- | --- |
| Steam | Reads `appmanifest_*.acf` in every Steam library folder | Windows, macOS, Linux. Shows installs and updates in progress. |
| Epic Games, GOG | The launchers' own manifests and registry keys | Windows only |
| EA app, Battle.net, Rockstar | Windows' installed programs list, filtered by publisher | Windows only |
| Ubisoft Connect, Riot (Valorant, League of Legends), Roblox | Registry and the launchers' own files | Windows only |
| Xbox app, Microsoft Store | PowerShell `Get-AppxPackage`, games only | Windows only |
| Everything else | A background search through all drives (depth 6, system folders skipped, 2 minute limit) | Finds folders with a program plus typical game files |
| By hand | "Add a game" button (pick an .exe, .lnk or .app) | Anything the scan missed |

Games found by the drive search that are not games can be hidden from their game page.

## Wallpapers: where the folders go

Put the `videos` and `images` folders in the project root, next to `package.json`:

```
crescent-launcher/
  package.json
  videos/   NightSky.mp4  AuroraBorealis.mp4  Milkyway.mp4  Singularity.mp4
  images/   NaturesCreativity.png  SnowyMountains.png  TheGreatWaveoffKanagawa.png  MountFuji.png
```

The names must match exactly. The build copies both folders next to the installed app. Wallpapers whose file is
missing show "Missing: put ... in the ... folder" on the Account page. GitHub's website accepts files up to 25 MB;
for bigger videos use git or GitHub Desktop (limit 100 MB per file), or compress them. Videos make the installer bigger.

## Profile pictures and banners

Banner: 1280 pixels wide, 400 to 700 tall. An image, or a video of at most 10 seconds (MP4 or WEBM).
Profile picture: PNG, JPG, WEBP or GIF, at least 128 by 128 pixels. Uploaded files are stored in the data folder.

## Run it locally

You need Node.js 20 or newer and git.

```bash
npm install          # installs electron, electron-builder, electron-updater, electron-log
npm start            # run the launcher
npm run dev          # same, with developer tools open
npm run dist         # build an installer into dist/ (no publishing)
```

Auto-update only runs in an installed build, never under `npm start`.

## Publish on GitHub with automatic installers and updates

1. Create an empty GitHub repository (public, so installed apps can check for updates without a token).
2. In `package.json`, replace `YOUR_GITHUB_USERNAME` and `YOUR_REPO_NAME` in two places: `repository.url` and `build.publish`.
3. Commit everything, including `package-lock.json` (the workflow needs it), and push:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git
   git push -u origin main
   ```
4. In the repository, open Settings, then Actions, then General, then Workflow permissions, and choose
   "Read and write permissions". The workflow also asks for this itself, but some organizations override it.
5. Release a version. The tag must match the `version` in `package.json`:

   ```bash
   npm version patch            # bumps package.json (1.0.0 to 1.0.1) and creates the tag v1.0.1
   git push --follow-tags
   ```
6. Watch the Actions tab. The workflow builds on Windows and macOS, uploads `Crescent-Setup-x.y.z.exe`,
   the `.dmg` and `.zip` files and `latest.yml` / `latest-mac.yml` to a draft release, then publishes it.
7. Install the first release. From then on, every new tag produces a new release, and installed copies download it
   on the next start (they re-check every four hours), show the "Restart to update" banner, and install on restart.

## Things that will trip you up

- **macOS auto-update needs a signed, notarized app.** Without an Apple Developer ID, Mac users can install from the
  `.dmg` but must download new versions by hand. To sign, add the repository secrets `MAC_CERTS` (base64 .p12) and
  `MAC_CERTS_PASSWORD`, and uncomment the Apple ID lines in `build.yml`.
- **Windows shows a SmartScreen warning** for unsigned installers. Auto-update still works.
- **The tag and `package.json` version must match**, or the workflow stops on purpose.
- **Private repositories** need a token inside the app to read releases. Use a public repository, or host updates elsewhere.
- Add `build/icon.png` (1024 by 1024) to get your own app icon. Without it, Electron's default icon is used.
