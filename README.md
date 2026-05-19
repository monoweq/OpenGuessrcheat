# OpenGuessr Cheat

A simple userscript for **OpenGuessr** that allows you to toggle the visibility of a map showing the exact location of your current guess. The map is powered by **Leaflet** and utilizes OpenStreetMap tiles. The map is resizable and movable for an enhanced user experience.

> **Note**: This script is intended for **educational purposes only** and is not affiliated with OpenGuessr or any other external service.

## Features

- **Show/Hide Map**: A button to toggle the map's visibility located at the top-right corner of the screen.
- **Location Marker**: The map will automatically place a marker at the location retrieved from the panorama iframe URL in OpenGuessr.
- **Closable**: The map can be closed by clicking the "-" button at the top-right of the map.
- **Lightweight**: No need for Google Maps API. The map uses OpenStreetMap tiles.

## Installation

To use this userscript, you will need a userscript manager like [Tampermonkey](https://www.tampermonkey.net/) or [Greasemonkey](https://www.greasespot.net/).

1. Install a userscript manager (e.g., Tampermonkey or Greasemonkey).
2. Create a new userscript in your manager and paste the code from the `main.js`.
3. Save and open the game.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This userscript is intended for educational purposes only and is not affiliated with or endorsed by OpenGuessr or any other third-party service. Use this script at your own risk.
