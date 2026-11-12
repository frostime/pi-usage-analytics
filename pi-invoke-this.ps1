# Local dev launcher: loads this checkout as the only instance of the package.
# .pi/settings.json filters the published npm copy out of this project; it needs
# the package installed at user scope (pi install npm:@frostime/pi-usage-analytics).
pi -e ".\src\index.ts" $args
