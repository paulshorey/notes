# API specs

OpenAPI \(v3\) is the way to go. But, there are so many options for editing/publishing it.

## [SwaggerHub](https://swagger.io/tools/swaggerhub/)

is the way to go for most people and teams. It is reasonably priced - $50/mo for a custom domain, and free if you host on their domain. 

There is also [Swagger-UI](https://swagger.io/tools/swagger-ui/), which is open-source, DIY, and in my opinion pretty bad for enterprise services, as it lacks a way to group endpoints or document anything other than individual endpoints. But, it visualizes your OpenAPI Yaml files, so it's much much better than nothing!

## [Dapperbox](http://dapperdox.io/)

is the better looking and more organized version of Swagger-UI. Use this if you want to host your own site, and don't need fancy features.

## [Stoplight.io](https://stoplight.io) 

**is a GUI editor which makes it really easy to write the spec.** Not as easy to publish it though. But it's so easy to edit, that I use it to edit, then export.

* Use the intuitive interface to create your specs. Include every necessary detail.
* Edit the `.yaml` file, if you prefer. It's great practice learning the spec to go back and forth between GUI and IDE.
* Export the yaml file, to import it somewhere else - like RapidAPI or Postman.

How to publish this? Stoplight.io is able to create a full website documentation. You can even export it in markdown format. However, their UI and navigation is pretty bad for site docs.

## [GitBook](https://gitbook.com) 

can also document an API very well. However, it is not currently possible to import/export as OpenAPI yaml files. That's a bummer, because OpenAPI is a requirement in tech. So, GitBook can not replace Stoplight/Swagger, but has to be an additional step. That's too bad, because GitBook API docs [look so good](https://nlp.studio/documentation)!

## Not Quite:

\*\*\*\*[**Redoc.ly**](https://redoc.ly/)  
****It's not ready, still under active development, and is overpriced for what you get.  
Here's a blog that sings its praises. Fun thing is this entire website \(if you just go to the domain without the path\) only hosts this one article. Lol. [https://mytech.reviews/best-free-api-documentation-tools/](https://mytech.reviews/best-free-api-documentation-tools/)

