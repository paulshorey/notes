# EC2 + SSL

[https://iwearshorts.com/blog/add-ssl-to-ec2-instance/](https://iwearshorts.com/blog/add-ssl-to-ec2-instance/)

You want https on your ec2 instance with nodejs? easy.

* Set up a new instance on EC2 \([aws.amazon.com/ec2](https://aws.amazon.com/ec2)\)
  * in your security group, open port 443  to “0.0.0.0/0”
* Associate an elastic IP address
* Get a new SSL Certificate \([aws.amazon.com/acm](https://aws.amazon.com/acm)\)
* Associate a new Load Balancer - In it, configure HTTPS and SSL Certificate settings



