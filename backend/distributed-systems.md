# Distributed systems

**Best way to publish an API to the world \(in 2020\):   
AWS** API Gateway + Lambada functions + Route 53 + DynamoDB.

**Now, Cloudflare** is getting into the **serverless** game. It's a contender because it's cheaper and easier to use.

\*\*\*\*[**Workers KV**](https://www.cloudflare.com/products/workers-kv/) **is competing with Dynamo DB.** It's made for quickly reading data from anywhere in the world. It's bad at handling multiple users/actions writing to the same key though. **It can replace Lambada** serverless functions for use cases which do not require making external requests or running algorithms, but simply grabbing data from a data store and returning the value.

[**Durable Objects**](https://blog.cloudflare.com/introducing-workers-durable-objects/) **is made for consistent writes from anywhere.** It can handle many users/actions updating the same key. It is not as globally distributed like Workers KV. Instead of syncing data to all datacenters, it migrates one datacenter close to whatever regions are using it. As with Workers KV, geo-routing and scaling is automatic!

The benefit of using this \(when possible for a certain use case\) is that it's much faster and cheaper to set up and get started. For an individual developer building out a proof of concept, AWS prices \($50/month/region\) get very expensive fast!













