# Error messages

**300**-level \(Redirection\) — Client needs to perform further actions to complete the request  
**400**-level \(Client error\) — Client sent an invalid request  
**500**-level \(Server error\) — Server failed to fulfill a valid request due to an error with server

There's not really a standard way of communicating errors/warnings for an HTTP REST API response. Lets see how different services do it in 2020:

**GraphQL response standard:**

```text
{
  "errors": [
    {
      "message": "Name for character with ID 1002 could not be fetched.",
      "locations": [ { "line": 6, "column": 7 } ],
      "path": [ "hero", "heroFriends", 1, "name" ]
    }
  ],
  "data": {
    "hero": {
      "name": "R2-D2",
      "heroFriends": [
        {
          "id": "1000",
          "name": "Luke Skywalker"
        },
        {
          "id": "1002",
          "name": null
        },
        {
          "id": "1003",
          "name": "Leia Organa"
        }
      ]
    }
  }
}
```

Twitter:

```text
{
    "errors": [
        {
            "code":215,
            "message":"Bad Authentication data."
        }
    ]
}

```

Facebook:

```text
{
    "error": {
        "message": "Missing redirect_uri parameter.",
        "type": "OAuthException",
        "code": 191,
        "fbtrace_id": "AWswcVwbcqfgrSgjG80MtqJ"
    }
}
```

APIsYouWontHate.com:

```text
HTTP/1.1 400 Bad Request

{
  "errors" : [{
    "code"   : 20010,
    "title"  : "Invalid geopoints for possible trip."
  }]
}
```

Google \([developers.google.com/webmaster-tools/search-console-api-original/v3/errors](https://developers.google.com/webmaster-tools/search-console-api-original/v3/errors)\):

```text
{
 "error": {
  "errors": [
   {
    "domain": "global",
    "reason": "invalidParameter",
    "message": "Invalid string value: 'asdf'. Allowed values: [mostpopular]",
    "locationType": "parameter",
    "location": "chart"
   }
  ],
  "code": 400,
  "message": "Invalid string value: 'asdf'. Allowed values: [mostpopular]"
 }
}
```

Consider adding a href/link/url property to your error object.

```text
{
  "error": {
    ...
    "href": "http://example.org/docs/errors/#ERR-01234"
  }
}
```

### 

### Summary from MediaWiki:

{% embed url="https://www.mediawiki.org/wiki/API:Errors\_and\_warnings" %}

**For fatal errors \(HTTP status 500\):** Return an object as value for key `error`, or an array of error objects as value for key `errors`. This is what Twitter and Facebook do. Each error object should contain a `code` and a `message` keys. The Google example above looks weird, but it's really just one error. The `errors` array inside it is just a description \(more details\) about the one error. There is only one error.

**For client errors \(HTTP status 400\):** Same as 500, but return `warning` or `warnings` instead of "error" or "errors".

Now, the only thing to decide is - to ALWAYS return an array of `errors` \(Twitter\) or sometimes return just one `error` object and other times return an array of `errors` \(Facebook\). Maybe your application will never need more than one error, but maybe in the future it will. Refactoring is a pain. So, it may be better to just return an array of errors/warnings. However, it's so much simpler with just one error.

For more, read [RFC 7231](https://tools.ietf.org/html/rfc7231#section-6).



