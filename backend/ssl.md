# SSL

### Best way to add HTTPS/SSL is by running `openssl`:

```text
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /srv/public/_certs/wordio.co.key -out /srv/public/_certs/wordio.co.crt
```

Just answer the questions when prompted:  
[https://www.thesslstore.com/knowledgebase/ssl-generate/csr-generation-guide-for-nginx-openssl/](https://www.thesslstore.com/knowledgebase/ssl-generate/csr-generation-guide-for-nginx-openssl/)

* **Common Name:** The FQDN \(fully-qualified domain name\) you want to secure with the certificate such as www.google.com, secure.website.org, \*.domain.net, etc.
* **Organization:** The full legal name of your organization including the corporate identifier.
* **Organization Unit \(OU\):** Your department such as ‘Information Technology’ or ‘Website Security.’
* **City or Locality:** The locality or city where your organization is legally incorporated. Do not abbreviate.
* **State or Province:** The state or province where your organization is legally incorporated. Do not abbreviate.
* **Country:** The official two-letter country code \(i.e. US, CH\) where your organization is legally incorporated.

### Or, generate a CSR for a premium/wildcard certificate authority.

For when buying a SSL such as RapidSSL through Name.com...  
"Common Name" or "domain name" should start with "www." or wildcard "\*".

### Once you have the "key" and "certificate" files, 

put them on the server, and point Nginx to them:

```text
server {
  listen 80;
  listen [::]:80;
  server_name nlp.domains www.nlp.domains;
  return 301 https://$server_name$request_uri;
}
server {
  listen 443 ssl;
  listen [::]:443;
  server_name nlp.domains www.nlp.domains;

  ssl on;
  ssl_certificate /root/.certs/nlp.domains.crt;
  ssl_certificate_key /root/.certs/nlp.domains.key;

  # Pass to Node.js?... no, Nginx is better!
  # location / {
  #   proxy_pass http://localhost:9000;
  #   proxy_http_version 1.1;
  #   proxy_set_header Upgrade $http_upgrade;
  #   proxy_set_header Connection 'upgrade';
  #   proxy_set_header Host $host;
  #   proxy_cache_bypass $http_upgrade;
  # }

  location / {
   root /srv/public/nlp-fe;
   index domain/index.html index.html;
  }
}



```



