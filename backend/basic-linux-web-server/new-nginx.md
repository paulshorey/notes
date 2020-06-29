# NginX

After [installing](new-ubuntu/) Nginx, edit files in `/etc/nginx/sites-available`... one for each server name \(domain name\) you will use.

./example  
./default  
./domain1.com  
./domain2.net

Nginx installation already comes with a "default" file. I like to rename that as "example", because that's what that is. Then, put my own default file.

After adding these configuration files, symlink each one into `/etc/nginx/sites-enabled` folder, like this:  
`ln -s /etc/nginx/sites-available/domain1.com /etc/nginx/sites-enabled`









