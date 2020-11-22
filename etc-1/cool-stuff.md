# Cool stuff

## Download Wikipedia! 

[https://dungtn.github.io/dataset/2019/01/18/wikipedia-data.html](https://dungtn.github.io/dataset/2019/01/18/wikipedia-data.html)  
[https://meta.wikimedia.org/wiki/Data\_dump\_torrents\#English\_Wikipedia](https://meta.wikimedia.org/wiki/Data_dump_torrents#English_Wikipedia)

**Import it to local ElasticSearch:**  
[https://www.bing.com/search?q=import%20wikipedia%20dump%20into%20elasticsearch&qs=n&form=QBRE&sp=-1&pq=import%20wikipedia%20dump%20into%20elasticsearc&sc=0-39&sk=&cvid=C3A13FC142174DF083F31C6148DC1B58](https://www.bing.com/search?q=import%20wikipedia%20dump%20into%20elasticsearch&qs=n&form=QBRE&sp=-1&pq=import%20wikipedia%20dump%20into%20elasticsearc&sc=0-39&sk=&cvid=C3A13FC142174DF083F31C6148DC1B58)  
\(search\)  
[https://stackoverflow.com/questions/47476122/loading-wikipedia-dump-into-elasticsearch](https://stackoverflow.com/questions/47476122/loading-wikipedia-dump-into-elasticsearch#)  
\(discussion\)  
[https://github.com/andrewvc/wikiparse](https://github.com/andrewvc/wikiparse)   
\(wikiparse.jar file it uses may be outdated\)  
[http://www.fuzihao.org/blog/2018/01/01/Struggling-in-importing-wikipedia-into-Elasticsearch/](http://www.fuzihao.org/blog/2018/01/01/Struggling-in-importing-wikipedia-into-Elasticsearch/) \(using LogStash\)  
[https://developer.aliyun.com/mirror/npm/package/wikipedia-elasticsearch-import ](https://github.com/pawelotto/wikipedia-elasticsearch-import)   
\(NPM package ??? OMG !!!\)

**Other resources:**  
[https://mwparserfromhell.readthedocs.io/en/latest/usage.html](https://mwparserfromhell.readthedocs.io/en/latest/usage.html)   
\(idk\)  
[https://dungtn.github.io/dataset/2019/01/18/wikipedia-data.html](https://dungtn.github.io/dataset/2019/01/18/wikipedia-data.html)  
\(import into MySQL\)

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







