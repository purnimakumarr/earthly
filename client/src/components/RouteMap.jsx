import { useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet';

const stopIcon = (label) =>
  L.divIcon({
    className: '',
    html: `<span class="stop-marker" style="width:28px;height:28px">${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });

// Stops are stored as GeoJSON [lng, lat]; Leaflet wants [lat, lng].
export default function RouteMap({ locations }) {
  const stops = useMemo(
    () =>
      locations.map((loc) => ({
        ...loc,
        position: [loc.coordinates[1], loc.coordinates[0]],
      })),
    [locations],
  );

  if (!stops.length) return null;

  const bounds = L.latLngBounds(stops.map((s) => s.position)).pad(0.3);

  return (
    <MapContainer
      bounds={bounds}
      scrollWheelZoom={false}
      className="h-96 w-full rounded-2xl border border-line"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <Polyline
        positions={stops.map((s) => s.position)}
        pathOptions={{ color: '#b5562f', weight: 2, dashArray: '6 6' }}
      />
      {stops.map((stop, i) => (
        <Marker key={stop._id || i} position={stop.position} icon={stopIcon(i + 1)}>
          <Popup>
            <strong>Day {stop.day}</strong>
            <br />
            {stop.description}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
