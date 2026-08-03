window.API_TESTING_CONFIG = {
  title: "VES (DVLA Vehicle Enquiry)",
  description: "Look up vehicle tax/MOT/technical details by registration number. Test and Production are separate DVLA environments.",
  endpoints: [
    {
      id: "vehicle-details",
      provider: "ves-uat",
      name: "Vehicle Details (UAT / test)",
      folder: null,
      method: "POST",
      pathParams: [],
      queryParams: [],
      bodyParams: [
        {
          key: "registrationNumber",
          example: "AA19AAA",
          required: true,
        },
      ],
    },
    {
      id: "vehicle-details",
      provider: "ves-production",
      name: "Vehicle Details (Production — real DVLA data)",
      folder: null,
      method: "POST",
      pathParams: [],
      queryParams: [],
      bodyParams: [
        {
          key: "registrationNumber",
          example: "",
          required: true,
        },
      ],
    },
  ],
};
