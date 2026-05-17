import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import GCalPlugin from "../main";

interface Props {
	plugin: GCalPlugin;
}

export default function CalendarPanel({ plugin }: Props) {
	return (
		<div style={{ height: "100%", overflow: "hidden" }}>
			<FullCalendar
				plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
				initialView="timeGridWeek"
				height="100%"
				events={[
					{
						title: "test event",
						start: new Date().toISOString(),
						end: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
					},
				]}
			/>
		</div>
	);
}