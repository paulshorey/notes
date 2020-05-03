# SSH

**1\) Connect to the server without a password:**  
`ssh root@1.2.3.456 -p 9000`   
  
**2. Copy local public SSH key to the remote:**  
[https://www.hostinger.com/tutorials/ssh/how-to-set-up-ssh-keys](https://www.hostinger.com/tutorials/ssh/how-to-set-up-ssh-keys)  
`ssh-copy-id user@serverip` 

**3. Then, disable password authentication to server \(for security\):**  
[https://www.hostinger.com/tutorials/vps/how-to-disable-ssh-password-authentication-on-vps](https://www.hostinger.com/tutorials/vps/how-to-disable-ssh-password-authentication-on-vps)  
`ne /etc/ssh/sshd_config`, edit \(comment out\) line `#PasswordAuthentication yes`  



