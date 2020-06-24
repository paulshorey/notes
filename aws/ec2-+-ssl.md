# EC2 web server

[aws.amazon.com/ec2](https://aws.amazon.com/ec2)

**Allow SSH port incoming traffic:**  
in EC2 security group, open port 443  to “0.0.0.0/0”



**Allow root SSH login:**  
\(temporarily, to do things like: `scp ~/.path2local root@1.1.1.1:~.path2remote`\)

`cp ~ubuntu/.ssh/authorized_keys ~root/.ssh/authorized_keys`   

\*\*\*\*

**Other useful things for later...**

* Associate an elastic IP address
* Get a new SSL Certificate \([aws.amazon.com/acm](https://aws.amazon.com/acm)\)
* Associate a new Load Balancer - In it, configure HTTPS and SSL Certificate settings







