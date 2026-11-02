# Madrid se mueve · screen saver

A macOS screen saver that shows Pulso in Modo pantalla, for Madrid or the Bay Area.
It is a web view on `https://madrid.lessane.es/?pantalla#pulso` (or `bayarea.lessane.es`), so every change to the site
reaches it on its own. System Settings > Screen Saver > Options picks the city and the language (automatic, Español,
English); the choice is kept in the screen saver's own defaults.

## Build and install
1. Open `MadridSaver.xcodeproj` in Xcode.
2. Product > Build (Cmd B).
3. In the project navigator, open Products, right click `MadridSaver.saver`, Show in Finder.
4. Double click `MadridSaver.saver`. macOS asks whether to install it for you only: yes.
5. System Settings > Screen Saver > Madrid se mueve. It sits among the other screen savers, under Other.

To update after a code change, build again and double click the new `.saver` (replace the old one).
Changes to the website need nothing: the saver loads the live page.

## Notes
- Needs a network connection; without one it shows a dark screen.
- The saver keeps its own browser storage, so places saved in Safari or Chrome are not there.
- `?pantalla` works in any browser too: it opens Pulso in screen mode with no exit button and no cursor.
