# NginX

**After** [**installing**](new-ubuntu/) **Nginx, edit files in `/etc/nginx/sites-available`... one for each server name \(domain name\) you will use:**  
/etc/nginx/sites-available/example  
/etc/nginx/sites-available/default  
/etc/nginx/sites-available/domain1.com  
/etc/nginx/sites-available/domain2.net

Nginx installation already comes with a "default" file. I like to rename that as "example", because that's what that is. Then, put my own default file.

After adding these configuration files, **symlink each one** into `/etc/nginx/sites-enabled` folder, like this:  
`ln -s /srv/public/_nginx/wordio.co /etc/nginx/sites-enabled` 

The symlink can actually be from anywhere, not just from `sites-available`!

\(Must use absolute paths!\)

#### Then, **restart** Nginx, 

like this: `service nginx restart`. 

### If it doesn't work, 

do `nginx -t` to find the syntax error.

## To redirect to another domain:

```text
server {
  server_name www.zawgihealth.com;
  rewrite ^/(.*)$ https://www.gofundme.com/f/Zanzibar-Lives-Matter-by-ZAWGI permanent;
}
```

\*\*\*\*

\*\*\*\*

\*\*\*\*





