# Cool stuff

## Download Wikipedia! 

And run it as a local MySQL database! :D  
[https://dungtn.github.io/dataset/2019/01/18/wikipedia-data.html](https://dungtn.github.io/dataset/2019/01/18/wikipedia-data.html)  
[https://meta.wikimedia.org/wiki/Data\_dump\_torrents\#English\_Wikipedia](https://meta.wikimedia.org/wiki/Data_dump_torrents#English_Wikipedia)

Read more:  
[https://mwparserfromhell.readthedocs.io/en/latest/usage.html](https://mwparserfromhell.readthedocs.io/en/latest/usage.html)

## Use neighbors' WiFi

I'm not a freeloader. I pay for my stuff. But right now, while traveling, my Airbnb host's internet is slow and unreliable. My phone is out of data, and I have to wait a bit to upgrade to unlimited \(it's Saturday, they're busy. Also waiting on my wife to sign up with them, then we'll be waiting for a new phone\). I did not go through with this, but it looks like it might work, if anyone is curious.

{% embed url="https://medium.com/@jansalvadorsebastian/hacking-wi-fi-penetration-on-macos-bc1f0f0f6296" caption="^^^ this is the best tutorial for Mac\*\*" %}

\*\*The above tutorial is missing instruction to install "airport" CLI command \(it has a typo, they copy-pasted wrong thing\). Use the below tutorial as a supplement:

{% embed url="https://martinsjean256.wordpress.com/2018/02/12/hacking-aircrack-ng-on-mac-cracking-wi-fi-without-kali-in-parallels/" %}

How to get cap2hccapx command to work:

```text
git clone git@github.com:hashcat/hashcat-utils.git
cd hashcat-utils/src
make
ln -s $(pwd)/cap2hccapx.bin /usr/local/bin/cap2hccapx
cd ../../
```






