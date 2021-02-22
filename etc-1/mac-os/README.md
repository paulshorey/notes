# Mac OS

#### Check which Mac OS version:

`sw_vers` 

#### Sleep

To disable sleep, even with lid closed:  
`sudo pmset -a disablesleep 1`  
  
To revert, allowing sleep again:  
`sudo pmset -a disablesleep 0`

## Downgrade to older version:

First, go to app store, and download the installer for the OS you want. Then, mount it onto a USB drive with one of the below commands:

#### Big Sur beta

sudo /Applications/Install\ macOS\ Big\ Sur\ Beta.app/Contents/Resources/createinstallmedia --volume /Volumes/MyVolume --nointeraction --downloadassets

\(We assume this will be the correct createinstallmedia code for the current beta\).

#### Catalina

sudo /Applications/Install\ macOS\ Catalina.app/Contents/Resources/createinstallmedia --volume /Volumes/MyVolume

#### Mojave

sudo /Applications/Install\ macOS\ Mojave.app/Contents/Resources/createinstallmedia --volume /Volumes/MyVolume

#### High Sierra

sudo /Applications/Install\ macOS\ High\ Sierra.app/Contents/Resources/createinstallmedia --volume /Volumes/MyVolume

