# Cool stuff

## Download Wikipedia! 

[https://dungtn.github.io/dataset/2019/01/18/wikipedia-data.html](https://dungtn.github.io/dataset/2019/01/18/wikipedia-data.html)  
[https://meta.wikimedia.org/wiki/Data\_dump\_torrents\#English\_Wikipedia](https://meta.wikimedia.org/wiki/Data_dump_torrents#English_Wikipedia)

Import it to your local MySQL database:  
[https://phabricator.wikimedia.org/source/mediawiki/browse/master/maintenance/tables.sql](https://phabricator.wikimedia.org/source/mediawiki/browse/master/maintenance/tables.sql)  
\(^^^first, create the tables\)  
[https://crates.io/crates/parse-mediawiki-sql/](https://crates.io/crates/parse-mediawiki-sql/) \(then, convert the dump into sql backup\)

Other resources:  
[https://mwparserfromhell.readthedocs.io/en/latest/usage.html](https://mwparserfromhell.readthedocs.io/en/latest/usage.html)

## Hack \(use\) neighbors' WiFi

Right now, while traveling, my Airbnb host's internet is slow and unreliable. My phone is out of data, and I have to wait a bit to upgrade to unlimited \(it's Saturday, they're busy. Also waiting on my wife to sign up with them, then we'll be waiting for a new phone\). I ended up not bothering with this, and just paid for more data, but these tutorials look like they might work. You will need some internet while figuring it out, and many hours of trying to break the password. With this tutorial, while trying to break the password, you are not denying your neighbor their wifi access. This only requires you to connect to their wifi initially, to download the "handshake", which contains the encrypted reference to their password. Then you'll have to decrypt it. It's much faster if they used a password from a commonly used database. So, use a long random password strings everybody!

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







