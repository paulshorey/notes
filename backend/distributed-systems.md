# Distributed systems

Forget what you know about that. CloudFlare is disrupting the industry.

Workers KV is replacing Dynamo DB + Lambada + Route 53. Like DynamoDB, but even more so, it is made primarily for reading data. It is bad at handling multiple users/actions writing to the same key, but it is good at running serverless functions like Lambada with automatic geo-distribution to all datacenters, with almost instant startup times.

For consistent writes - a distributed system which can handle many users/actions updating the same key - is their new "Durable Objects", which is still in beta. It is not as globally distributed like Workers KV, but it migrates one datacenter close to whatever regions are using it.





