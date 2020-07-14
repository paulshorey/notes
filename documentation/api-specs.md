# API specs

OpenAPI \(v3\) is the way to go. But, there are so many options for editing/publishing it.

SwaggerHub

| **Feature** | [**ReDoc**](https://redoc.ly/) | [**Swagger-UI**](https://swagger.io/tools/swagger-ui/) | [**DapperDox**](http://dapperdox.io/) |
| :--- | :--- | :--- | :--- |
| OpenAPI v2 | Yes | Yes | Yes – Albeit finicky |
| OpenAPI v3 | Yes | Yes | Unknown |
| URL for example code and data | Yes | No – Generates sample data object | No |
| Extensions for improved user experience | Yes | No | No |
|  |  |  |  |

My \(other\) favorites:

### [Stoplight.io](https://stoplight.io) is a GUI editor which makes it really easy to write the spec.

Not as easy to publish it though. But it's so easy to edit, that I use it to edit, then export.

* Use the intuitive interface to create your specs. Include every necessary detail.
* Edit the `.yaml` file, if you prefer. It's great practice learning the spec to go back and forth between GUI and IDE.
* Export the yaml file, to import it somewhere else - like RapidAPI or Postman.

How to publish this? Stoplight.io is able to create a full website documentation. You can even export it in markdown format. However, their UI and navigation is pretty bad for site docs.

### [GitBook](https://gitbook.com) 

can also document an API very well. However, it is not currently possible to import/export as OpenAPI yaml files. That's a bummer, because OpenAPI is a requirement in tech. So, GitBook can not replace Stoplight/Swagger, but has to be an additional step. That's too bad, because GitBook API docs [look so good](https://nlp.studio/documentation)!

