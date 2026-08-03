window.API_TESTING_CONFIG = {
  provider: "police",
  title: "UK Police Data",
  description: "data.police.uk street-level crime, stop-and-search, and force data. No API key required.",
  endpoints: [
  {
    "id": "availability-crimes-street-dates",
    "name": "Availability (crimes-street-dates)",
    "folder": "Availability",
    "method": "GET",
    "pathTemplate": "/crimes-street-dates",
    "pathParams": [],
    "queryParams": []
  },
  {
    "id": "list-forces",
    "name": "List forces",
    "folder": "Forces",
    "method": "GET",
    "pathTemplate": "/forces",
    "pathParams": [],
    "queryParams": []
  },
  {
    "id": "specific-force",
    "name": "Specific force",
    "folder": "Forces",
    "method": "GET",
    "pathTemplate": "/forces/:force",
    "pathParams": [
      "force"
    ],
    "queryParams": []
  },
  {
    "id": "force-senior-officers",
    "name": "Force senior officers",
    "folder": "Forces",
    "method": "GET",
    "pathTemplate": "/forces/:force/people",
    "pathParams": [
      "force"
    ],
    "queryParams": []
  },
  {
    "id": "street-level-crimes-point",
    "name": "Street-level crimes (point)",
    "folder": "Crimes",
    "method": "GET",
    "pathTemplate": "/crimes-street/:crimeCategory",
    "pathParams": [
      "crimeCategory"
    ],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "lat",
        "example": "",
        "required": true
      },
      {
        "key": "lng",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "street-level-crimes-custom-area-via-poly",
    "name": "Street-level crimes (custom area via poly)",
    "folder": "Crimes",
    "method": "GET",
    "pathTemplate": "/crimes-street/:crimeCategory",
    "pathParams": [
      "crimeCategory"
    ],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "poly",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "street-level-outcomes-location-id",
    "name": "Street-level outcomes (location_id)",
    "folder": "Crimes",
    "method": "GET",
    "pathTemplate": "/outcomes-at-location",
    "pathParams": [],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "location_id",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "street-level-outcomes-lat-lng",
    "name": "Street-level outcomes (lat/lng)",
    "folder": "Crimes",
    "method": "GET",
    "pathTemplate": "/outcomes-at-location",
    "pathParams": [],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "lat",
        "example": "",
        "required": true
      },
      {
        "key": "lng",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "street-level-outcomes-poly",
    "name": "Street-level outcomes (poly)",
    "folder": "Crimes",
    "method": "GET",
    "pathTemplate": "/outcomes-at-location",
    "pathParams": [],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "poly",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "crimes-at-a-location-location-id",
    "name": "Crimes at a location (location_id)",
    "folder": "Crimes",
    "method": "GET",
    "pathTemplate": "/crimes-at-location",
    "pathParams": [],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "location_id",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "crimes-at-a-location-lat-lng",
    "name": "Crimes at a location (lat/lng)",
    "folder": "Crimes",
    "method": "GET",
    "pathTemplate": "/crimes-at-location",
    "pathParams": [],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "lat",
        "example": "",
        "required": true
      },
      {
        "key": "lng",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "crimes-with-no-location",
    "name": "Crimes with no location",
    "folder": "Crimes",
    "method": "GET",
    "pathTemplate": "/crimes-no-location",
    "pathParams": [],
    "queryParams": [
      {
        "key": "category",
        "example": "",
        "required": true
      },
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "force",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "crime-categories",
    "name": "Crime categories",
    "folder": "Crimes",
    "method": "GET",
    "pathTemplate": "/crime-categories",
    "pathParams": [],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "crime-last-updated",
    "name": "Crime last updated",
    "folder": "Crimes",
    "method": "GET",
    "pathTemplate": "/crime-last-updated",
    "pathParams": [],
    "queryParams": []
  },
  {
    "id": "outcomes-for-a-specific-crime-persistent-id",
    "name": "Outcomes for a specific crime (persistent_id)",
    "folder": "Crimes",
    "method": "GET",
    "pathTemplate": "/outcomes-for-crime/:crimePersistentId",
    "pathParams": [
      "crimePersistentId"
    ],
    "queryParams": []
  },
  {
    "id": "list-neighbourhoods-for-a-force",
    "name": "List neighbourhoods for a force",
    "folder": "Neighbourhoods",
    "method": "GET",
    "pathTemplate": "/:force/neighbourhoods",
    "pathParams": [
      "force"
    ],
    "queryParams": []
  },
  {
    "id": "specific-neighbourhood",
    "name": "Specific neighbourhood",
    "folder": "Neighbourhoods",
    "method": "GET",
    "pathTemplate": "/:force/:neighbourhood",
    "pathParams": [
      "force",
      "neighbourhood"
    ],
    "queryParams": []
  },
  {
    "id": "neighbourhood-boundary",
    "name": "Neighbourhood boundary",
    "folder": "Neighbourhoods",
    "method": "GET",
    "pathTemplate": "/:force/:neighbourhood/boundary",
    "pathParams": [
      "force",
      "neighbourhood"
    ],
    "queryParams": []
  },
  {
    "id": "neighbourhood-team",
    "name": "Neighbourhood team",
    "folder": "Neighbourhoods",
    "method": "GET",
    "pathTemplate": "/:force/:neighbourhood/people",
    "pathParams": [
      "force",
      "neighbourhood"
    ],
    "queryParams": []
  },
  {
    "id": "neighbourhood-events",
    "name": "Neighbourhood events",
    "folder": "Neighbourhoods",
    "method": "GET",
    "pathTemplate": "/:force/:neighbourhood/events",
    "pathParams": [
      "force",
      "neighbourhood"
    ],
    "queryParams": []
  },
  {
    "id": "neighbourhood-priorities",
    "name": "Neighbourhood priorities",
    "folder": "Neighbourhoods",
    "method": "GET",
    "pathTemplate": "/:force/:neighbourhood/priorities",
    "pathParams": [
      "force",
      "neighbourhood"
    ],
    "queryParams": []
  },
  {
    "id": "locate-neighbourhood",
    "name": "Locate neighbourhood",
    "folder": "Neighbourhoods",
    "method": "GET",
    "pathTemplate": "/locate-neighbourhood",
    "pathParams": [],
    "queryParams": [
      {
        "key": "q",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "stops-by-area-point",
    "name": "Stops by area (point)",
    "folder": "Stop and search",
    "method": "GET",
    "pathTemplate": "/stops-street",
    "pathParams": [],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "lat",
        "example": "",
        "required": true
      },
      {
        "key": "lng",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "stops-by-area-poly",
    "name": "Stops by area (poly)",
    "folder": "Stop and search",
    "method": "GET",
    "pathTemplate": "/stops-street",
    "pathParams": [],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "poly",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "stops-at-location",
    "name": "Stops at location",
    "folder": "Stop and search",
    "method": "GET",
    "pathTemplate": "/stops-at-location",
    "pathParams": [],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "location_id",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "stops-with-no-location",
    "name": "Stops with no location",
    "folder": "Stop and search",
    "method": "GET",
    "pathTemplate": "/stops-no-location",
    "pathParams": [],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "force",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "stops-by-force",
    "name": "Stops by force",
    "folder": "Stop and search",
    "method": "GET",
    "pathTemplate": "/stops-force",
    "pathParams": [],
    "queryParams": [
      {
        "key": "date",
        "example": "",
        "required": true
      },
      {
        "key": "force",
        "example": "",
        "required": true
      }
    ]
  }
],
};
