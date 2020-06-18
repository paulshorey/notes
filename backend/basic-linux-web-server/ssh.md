# SSH

**1\) Connect to the server:**  
`ssh root@1.2.3.456 -p 9000` \(using specific port 9000, for example\)  
  
**2. Copy local public SSH key to the remote:**  
`ssh-copy-id -i ~/.ssh/newssh root@96.9.209.156`    
**Test it by connecting, using same key:**  
`ssh -i ~/.ssh/newssh root@96.9.209.156`  

**3. Then, disable password authentication to server \(for security\)**  
Once connected into remote server, do this:  
`ne /etc/ssh/sshd_config`, edit \(comment out\) line `#PasswordAuthentication yes`  



