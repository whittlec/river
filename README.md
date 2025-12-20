# River Levels

A simple app to show the river levels at York City Rowing Club.

It shows observed and forecast data of the [River Ouse level at Viking
Recorder](https://check-for-flooding.service.gov.uk/station/8208).

It aims to act as an indicator as to whether it might be expected to be able to
row.

## Functionality

*   **Live Data**: Fetches real-time observed and forecast river levels from the
    Environment Agency.
*   **Safety Status**: Instantly indicates if the river is below the configured
    safe rowing level.
*   **Contextual Visualization**: The chart includes background shading for
    weekends and daylight hours to aid planning.
*   **Offline Support**: Data is cached locally, allowing the chart to load
    instantly on return visits.
*   **Interactive Controls**: Users can switch between different time windows (1
    day to 1 year) to view trends.

## Disclaimer

This app cannot safely be used to accurately decide whether or not it is truly
safe to row on the river. Users should exercise caution and always adhere to the
rules of their rowing club.

## TODO

-   **Configuration**: Allow users to customize the safe rowing level (e.g., for
    different boat types or experience levels).
-   **Weather Integration**: Include wind speed and precipitation data, as these
    also affect rowing safety.
-   **Notifications**: Add push notifications to alert users when the river
    status changes (e.g., becomes safe to row).
-   **PWA Support**: Convert the application into a Progressive Web App for
    better mobile experience and offline capabilities.
-   **Dark Mode**: Add a dark theme for better visibility in low-light
    conditions.
-   Determine the correct maximum safe rowing height (currently displays 1.9m as
    safe).
