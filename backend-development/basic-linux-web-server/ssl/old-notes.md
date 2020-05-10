# Old notes

[https://gist.github.com/cecilemuller/a26737699a7e70a7093d4dc115915de8](https://gist.github.com/cecilemuller/a26737699a7e70a7093d4dc115915de8)

**Configure NginX \(with initial settings, before SSL\)**

```text
server {
    listen 80 default_server;
    listen [::]:80 default_server ipv6only=on;

    server_name c.paulshorey.com;
    root /www/c.ps/app;

    index index.html;

    location / {
            try_files $uri $uri/ =400;
    }

    location ~ /\.well-known/acme-challenge {
        default_type 'text/plain';
        root /www/sslcert; #or wherever dir
        try_files /$uri /;
    }
}
```

**Then install certificate**

```text
sudo apt-get install software-properties-common
sudo add-apt-repository ppa:certbot/certbot
sudo apt-get update
sudo apt-get install certbot
mkdir /www/sslcert #or wherever you want to put it
certbot certonly --webroot --agree-tos --no-eff-email --email ps@artspaces.net -w /www/sslcert -d jobs.paulshorey.com
```

**If paths in server configuration are correct.** Notice it says `/etc/letsencrypt/live/jobs.paulshorey.com/privkey.pem`

```text
Using the webroot path /www/sslcert for all unmatched domains.
Waiting for verification...
Cleaning up challenges

IMPORTANT NOTES:
 - Congratulations! Your certificate and chain have been saved at:
   /etc/letsencrypt/live/jobs.paulshorey.com/fullchain.pem
   Your key file has been saved at:
   /etc/letsencrypt/live/jobs.paulshorey.com/privkey.pem
   Your cert will expire on 2018-05-25. To obtain a new or tweaked
   version of this certificate in the future, simply run certbot
   again. To non-interactively renew *all* of your certificates, run
   "certbot renew"
 - If you like Certbot, please consider supporting our work by:

   Donating to ISRG / Let's Encrypt:   https://letsencrypt.org/donate
   Donating to EFF:                    https://eff.org/donate
```

**Test that renewal will work:**

```text
sudo certbot renew --dry-run
```

**Create** `weekly.sh` **script that** `/etc/crontab` **runs weekly, to auto-update**

```text
sudo certbot renew
service nginx restart
```

**Create config snippet in** `/etc/nginx/snippets/ssl.conf` **to use later, for any server block \(see next\):**

```text
ssl_session_timeout 1d;
ssl_session_cache shared:SSL:50m;
ssl_session_tickets off;

ssl_protocols TLSv1.2;
ssl_ciphers EECDH+AESGCM:EECDH+AES;
ssl_ecdh_curve secp384r1;
ssl_prefer_server_ciphers on;

ssl_stapling on;
ssl_stapling_verify on;

add_header Strict-Transport-Security "max-age=15768000; includeSubdomains; preload";
add_header X-Frame-Options DENY;
add_header X-Content-Type-Options nosniff;
```

**Update server config to include port 443 and app logic**

```text
server {

server_name c.paulshorey.com;
root /www/c.ps/app;
index index.html;
listen 80 default_server;
listen [::]:80 default_server ipv6only=on;

location / {
        try_files $uri $uri/ =400;
}
location ~ /\.well-known/acme-challenge {
        default_type 'text/plain';
        root /www/sslcert; #or wherever dir
        try_files /$uri /;
}
location /api/v1 {
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Host $http_host;
        proxy_pass 'http://localhost:1080';
}

# ENABLE SSL
listen 443 ssl http2;
listen [::]:443 ssl http2;
ssl_certificate /etc/letsencrypt/live/c.paulshorey.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/c.paulshorey.com/privkey.pem;
ssl_trusted_certificate /etc/letsencrypt/live/c.paulshorey.com/fullchain.pem;

}
```

Here...

1. /\*:80 is forwarded to /\*:3000
2. /api\*:80 is forwarded to /api\*:1080
3. and everything is served over https, which is port :443

