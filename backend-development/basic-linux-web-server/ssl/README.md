# SSL

**Documentation:**  
[https://certbot.eff.org/docs/using.html](https://certbot.eff.org/docs/using.html#plugins)  
`certbot renew --pre-hook "service nginx stop" --post-hook "service nginx start"`

**Install:**  
Using Apache?:  
[https://www.digitalocean.com/community/tutorials/how-to-secure-apache-with-let-s-encrypt-on-ubuntu-18-04](https://www.digitalocean.com/community/tutorials/how-to-secure-apache-with-let-s-encrypt-on-ubuntu-18-04)  
[https://www.serverlab.ca/tutorials/linux/web-servers-linux/using-lets-encrypt-with-apache-on-ubuntu-18-04/](https://www.serverlab.ca/tutorials/linux/web-servers-linux/using-lets-encrypt-with-apache-on-ubuntu-18-04/)

```text
sudo apt update
sudo apt install software-properties-common
sudo add-apt-repository universe
sudo add-apt-repository ppa:certbot/certbot -y

sudo apt install certbot python-certbot-apache
```

**Configure server:**  
Add **`ServerName api.wordsalad.ai`** to file `/etc/apache2/apache2.conf`  
`sudo service apache2 restart` to restart server.  
`sudo apache2ctl configtest` to test configuration.

`sudo certbot --apache`

