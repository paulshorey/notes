---
description: 'See https://openapi.tools/ for an incomplete, but very useful list of tools!'
---

# API reference

### [OpenAPI \(v3\) specification](https://swagger.io/specification/) 

is the way to document your APIs, but it's a lot to learn, so it helps to use an editor, at first. And you'll need to publish the spec as a website...

## Option 1. Build documentation from OpenAPI file:

### [ReDocly](https://github.com/Redocly/redoc) self-hosted

Used by Netlify. Very similar to [Slate docs](website-from-files.md), but better for API reference. Documents GET/POST/REST verbs. Build from your OpenAPI spec! SaaS available at [Redoc.ly](https://Redoc.ly) 

Unfortunately, unlike Slate, this has many boilerplate elements taking up space. Slate docs is very open. You can write anything. I like that it leaves room for text. ReDocly takes up a lot of space in padding and boilerplate \(like explaining what content type something is\).

## Option 2. GUI to help build spec AND website:

Design your OpenAPI spec and documentation without actually knowing and coding the OpenAPI Yaml/JSON formatted file manually. The spec is pretty complicated for occasional users, so a tool like this helps. If you are a backend programmer, or want to get into API development, then you should learn the spec, and write it manually like you would for a computer program or configuration file.

### [ReDocly](https://ReDoc.ly) hosted service

Not sure if it's possible. Could be at the $300/mo price point. I didn't try it. I'd rather just write the OpenAPI spec myself, and use the self-hosted service. Also, I like being able to customize the documentation site styles, layouts, and integration. With their SaaS service, you'd be stuck with their styles and layout.

### [Stoplight.io](https://stoplight.io) 

**Makes it very easy to write the spec!** Not easy to publish it though. :\( But it's so easy to edit, that I use it to edit, then export the yaml file. Soon, I'll get good enough to just edit the yaml file, and will not need this crutch. Highly recommended for anyone just learning the OpenAPI spec.

* Use the intuitive interface to create your specs. Include every necessary detail.
* Edit the `.yaml` file, if you prefer. It's great practice learning the spec to go back and forth between GUI and IDE.
* Export the yaml file, to import it somewhere else - like RapidAPI or Postman.

How to publish this? Stoplight.io is able to create a full website documentation. You can even export it in markdown format. However, their UI and navigation is pretty bad for site docs.

### [RapidAPI](https://rapidapi.com)

The largest \(and only, since they bought MashApe\) marketplace. It's been around for a while. Consuming APIs on this is great! It just works! Signing up, testing, and paying for it is straightforward. Selling APIs is easy. They take care of payments and authentication. They act as a Proxy for your APIs. They take care of everything, but keep 20% of whatever you charge. The admin dashboard is under active development, with new features and bug fixes coming out regularly.

RapidAPI.com could actually be used for API documentation. In fact, they have code snippets for all major languages and platforms, to make consuming an API very easy. Clients can test the API instantly, on their app. As a publisher, you can import/export OpenAPI files. The reason this is not the \#1 option, is that importing an OpenAPI file into RapidAPI is a little bit buggy. Exporting your API spec and examples is possible, but you have to contact technical support, and they will generate it for you - not instantly.

## Option 3. Edit the code manually.

And the app will generate a documentation website. This is for pro users:

### [SwaggerHub](https://swagger.io/tools/swaggerhub/)

is the way to go for most people and teams. It is reasonably priced - $50/mo for a custom domain, and free if you host on their domain. 

There is also [Swagger-UI](https://swagger.io/tools/swagger-ui/), which is open-source, DIY, and in my opinion pretty bad for enterprise services, as it lacks a way to group endpoints or document anything other than individual endpoints. But, it visualizes your OpenAPI Yaml files, so it's much much better than nothing!

### [Dapperbox](http://dapperdox.io/)

is the better looking and more organized version of Swagger-UI. Use this if you want to host your own site, and don't need fancy features.

## Option 4. Don't bother with the OpenAPI spec:

Just write good documentation, not in the standard format. It can come out even better and clearer, and easier to read. However, you won't be able to import/export it across services.

### [GitBook](https://gitbook.com) 

can also document an API very well. However, it is not currently possible to import/export as OpenAPI yaml files. That's a bummer, because OpenAPI is a requirement in tech. So, GitBook can not replace Stoplight/Swagger. I still use it to publish my API reference, though I have to do it as an additional step \(double the work\). However, I write it on GitBook first, because the interface is so easy to use. This way, I can quickly draft it and change it until it is correct. Then I go to Stoplight \(or Swagger\) to edit the real spec.

It's worth it, because the API reference comes out [looking so good](https://nlp.studio/documentation)!

### [Slate](https://github.com/sdelements/node-slate)

see "[website from markdown](website-from-files.md)" article.

## **Options to** avoid:

### Redoc.ly

It's not ready, still under active development, and is overpriced for what you get.

Here's a blog that sings its praises. Fun thing is this entire website \(if you just go to the domain without the path\) only hosts this one article. The domain "mytech.reviews" must have been bought by Redoc.ly, just for this purpose. Lol. [https://mytech.reviews/best-free-api-documentation-tools/](https://mytech.reviews/best-free-api-documentation-tools/) How did they get to Google's first page of results??? I need to figure out this voodoo magic!

