# Old Mac computer

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

### Etc:

To disable dedicated GPU:  
[https://apple.stackexchange.com/questions/166876/macbook-pro-how-to-disable-discrete-gpu-permanently-from-efi](https://apple.stackexchange.com/questions/166876/macbook-pro-how-to-disable-discrete-gpu-permanently-from-efi)

To replace cooling fans:  
[https://www.ifixit.com/Guide/MacBook+Pro+15-Inch+Retina+Display+Mid+2014+Right+Fan+Replacement/27690](https://www.ifixit.com/Guide/MacBook+Pro+15-Inch+Retina+Display+Mid+2014+Right+Fan+Replacement/27690)





