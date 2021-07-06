# SSH

To simply upload some files to the server, use SCP:  
`scp -r /path/from/* root@18.217.8.193:/path/to`

To copy FROM the server, to local,  
`scp root@142.93.251.57:~/words.data.sql ~/Documents` 

To use an SSH key, the file must have strict permissions. Set them like this:`chmod 400 ~/.ssh/awsssh.pem` 

BTW, to assign ownership of a directory to the current user and group, on Mac:  
`sudo chown admin:wheel /srv`   

{% tabs %}
{% tab title="1. Connect to local to server" %}
**Test connection, using password authentication, or whatever**  
`ssh user@host -p 9000` \(using specific port 9000, for example\)  
  
  
**Copy public SSH key to the remote server**  
This will enable it to always trust your local computer, without having to use ssh-agent.  
`ssh-copy-id -i ~/.ssh/newssh user@host`    
Read  more: [https://www.ssh.com/ssh/copy-id](https://www.ssh.com/ssh/copy-id)  
  
Test it by connecting, using this specific key:  
****`ssh -i ~/.ssh/newssh user@host`    


**Then, disable password authentication to server \(for security\)**  
Once connected into remote server, do this:  
`ne /etc/ssh/sshd_config`, edit \(comment out\) line `#PasswordAuthentication yes`  
{% endtab %}

{% tab title="2. Connect server to Github" %}
Upload a private key, which corresponds to the public key on Github.  
`scp ~/.ssh/newssh root@96.9.209.156:~/.ssh/` 

Install that key whenever a terminal is opened:  
`echo "eval $(ssh-agent -s); ssh-add ~/.ssh/newssh;" >> ~/.zprofile`
{% endtab %}
{% endtabs %}



