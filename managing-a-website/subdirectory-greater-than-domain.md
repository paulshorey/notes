# Subdirectory -&gt; Domain

How to serve contents/urls of an external domain from the subdirectory of your primary domain

Either setup path based routing in an Application Load Balancer \(you would need to switch to an ALB if you are currently using a classic ELB\), or place CloudFront in front of your domain and configure it with two sources.

{% embed url="https://aws.amazon.com/premiumsupport/knowledge-center/cloudfront-distribution-serve-content/" %}



