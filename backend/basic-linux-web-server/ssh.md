# SSH

**1\) Connect to the server:**  
`ssh root@1.2.3.456 -p 9000` \(using specific port 9000, for example\)  
  
**2 \(public key\). Copy local public SSH key to the remote server.**  
This will enable it to always trust your local computer, without having to use ssh-agent.  
`ssh-copy-id -i ~/.ssh/newssh root@96.9.209.156`    
Read  more: [https://www.ssh.com/ssh/copy-id](https://www.ssh.com/ssh/copy-id)  
  
Test it by connecting, using same key:  
****`ssh -i ~/.ssh/newssh root@96.9.209.156`  

**2 \(optional, private key\).** If the server will need to clone/pull from Github, also give it a private key, which corresponds to the public key on Github. This doesn't have to be the same pair as done previously.  
`scp ~/.ssh/newssh.pub root@96.9.209.156:~/.ssh/`   
`scp ~/.ssh/newssh root@96.9.209.156:~/.ssh/` 

**3. Then, disable password authentication to server \(for security\)**  
Once connected into remote server, do this:  
`ne /etc/ssh/sshd_config`, edit \(comment out\) line `#PasswordAuthentication yes`  



