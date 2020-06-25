# SSH

To simply upload some files to the server, use SCP:  
`scp -r /path/to root@18.217.8.193:/path/to` 

{% tabs %}
{% tab title="Connect to local to server" %}
**Test connection, using password authentication, or whatever**  
`ssh root@1.2.3.456 -p 9000` \(using specific port 9000, for example\)  
  
  
**Copy public SSH key to the remote server**  
This will enable it to always trust your local computer, without having to use ssh-agent.  
`ssh-copy-id -i ~/.ssh/newssh root@96.9.209.156`    
Read  more: [https://www.ssh.com/ssh/copy-id](https://www.ssh.com/ssh/copy-id)  
  
Test it by connecting, using this specific key:  
****`ssh -i ~/.ssh/newssh root@96.9.209.156`    


**Then, disable password authentication to server \(for security\)**  
Once connected into remote server, do this:  
`ne /etc/ssh/sshd_config`, edit \(comment out\) line `#PasswordAuthentication yes`  
{% endtab %}

{% tab title="Connect server to GIThub" %}
Upload a private key, which corresponds to the public key on Github.  
`scp ~/.ssh/newssh root@96.9.209.156:~/.ssh/` 

Install that key whenever a terminal is opened:  
`echo "eval $(ssh-agent -s); ssh-add ~/.ssh/newssh;" >> ~/.zprofile`
{% endtab %}
{% endtabs %}



