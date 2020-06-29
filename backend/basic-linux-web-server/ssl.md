# SSL

### Best way to add HTTPS/SSL is by running `openssl`:

`sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /etc/ssl/private/nginx-selfsigned.key -out /etc/ssl/certs/nginx-selfsigned.crt`  
[https://www.digitalocean.com/community/tutorials/how-to-create-a-self-signed-ssl-certificate-for-nginx-in-ubuntu-18-04](https://www.digitalocean.com/community/tutorials/how-to-create-a-self-signed-ssl-certificate-for-nginx-in-ubuntu-18-04)

### or, generate a CSR for a premium/wildcard certificate authority:

[https://www.thesslstore.com/knowledgebase/ssl-generate/csr-generation-guide-for-nginx-openssl/](https://www.thesslstore.com/knowledgebase/ssl-generate/csr-generation-guide-for-nginx-openssl/)  
For when buying a SSL such as RapidSSL through Name.com...  
"Common Name" or "domain name" should start with "www." or wildcard "\*".

### Once you have the "key" and "certificate" files, 

put them on the server, and point Nginx to them.





