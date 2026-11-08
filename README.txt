PODIUM DESKTOP
The Electron version of Podium. It is separate from the browser version in the
Podium folder, and either one works without the other.

RUN IT
  Double-click "Start Podium Desktop.bat", or run app\Podium.exe.

OPEN .PPTX FILES BY DOUBLE-CLICKING
  Right-click a .pptx > Open with > Choose another app > Choose an app on your PC,
  then pick app\Podium.exe. Tick "Always" only if you want it to replace PowerPoint
  as the default. This is Windows' own setting; Podium never changes it for you.

DELETE IT
  1. Close Podium Desktop.
  2. Delete this whole "Podium Desktop" folder.
  That removes everything. It has no installer and writes nothing to the registry
  or AppData. The browser version isn't affected, and your saved .pptx files stay
  wherever you saved them.

  Only unsaved crash-recovery copies and the Recent list live in this folder (in
  "data"), so those go with it.

  If you set it as an "Open with" choice, Windows may keep a dead entry in that
  menu. If you made it the default for .pptx, choose another default app in
  Windows Settings > Apps > Default apps.

IF SMART APP CONTROL BLOCKS IT
  Podium.exe isn't digitally signed. Smart App Control allowed it when it was
  tested on this PC, but Windows can change that decision. If it gets blocked, use
  the steps above to delete it and keep using the browser version:
  Desktop\Podium\Start Podium.bat

WHAT'S IN THIS FOLDER
  app      The program, with its own copy of Podium
  data     Recent list and crash recovery (created on first run)
  _source  The desktop code and build script

REBUILD AFTER CHANGING THE BROWSER VERSION
  The app has its own copy of Podium, so changes to the browser version don't reach
  it until you rebuild. Close Podium Desktop, then in the _source folder run:
    npm install
    npm run build

BUILD IT FROM GITHUB
  The GitHub repo holds the code only, so there is no app folder until you build.
  The build needs the browser version next to this folder:
    git clone https://github.com/vedantgangrade21/podium Podium
    git clone https://github.com/vedantgangrade21/podium-desktop "Podium Desktop"
    cd "Podium Desktop\_source"
    npm install
    npm run build
