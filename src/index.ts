import "@logseq/libs";
import { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin.user";
import dayjs from "dayjs";
import { getDateForPage } from "logseq-dateutils";

const SETTINGS_SCHEMA: SettingSchemaDesc[] = [
  {
    default: "DONE, NOW, LATER, DOING, TODO, WAITING, CANCELLED",
    description: "Task markers to track when changing the status of tasks.",
    title: "Task markers",
    key: "taskMarkers",
    type: "string",
  },
  {
    default: "DONE, CANCELLED",
    description: "Task markers to add completion date.",
    title: "Task markers 'complete'",
    key: "taskMarkersComplete",
    type: "string",
  },
  {
    default: true,
    description: "Include date when completing tasks.",
    title: "Include date?",
    key: "includeDate",
    type: "boolean",
  },
  {
    default: "completed",
    description: "Property to use for date when marking tasks as completed.",
    title: "Completed date property",
    key: "completedDateProperty",
    type: "string",
  },
  {
    default: false,
    description: "Include time when completing tasks.",
    title: "Include time?",
    key: "includeTime",
    type: "boolean",
  },
  {
    default: "time",
    description: "Property to use for time when marking tasks as completed.",
    title: "Completed time property",
    key: "completedTimeProperty",
    type: "string",
  },

  {
    default: "HH:mm",
    description:
      "Time format to use when including time. See: https://day.js.org/docs/en/parse/string-format",
    title: "Time format",
    key: "timeFormat",
    type: "string",
  },
];

const splitTaskMarkers = (taskMarkers: string | undefined) => {
  if (!taskMarkers) {
    return [];
  }

  return String(taskMarkers)
    .split(",")
    .map((marker) => marker.trim());
};

logseq.useSettingsSchema(SETTINGS_SCHEMA);

/**
 * Removes the logbook entry and properties from the content string, because adding it via `updateBlock` causes it to appear in the editor text.
 * The actual logbook data is still preserved by Logseq, this just ensures it doesn't appear in the editor text.
 */
function stripLogbookAndBlockProperties(content: string) {
  const contentLines = content.split('\n');
  const filteredLines = contentLines.filter(line => !line.match(/^(\S+::|:LOGBOOK:|CLOCK:|:END:)/));

  return filteredLines.join('\n');
}


function main() {
  let TASK_MARKERS = new Set(
    splitTaskMarkers(logseq.settings?.taskMarkers as string)
  );
  let TASK_MARKERS_COMPLETE = new Set(
     splitTaskMarkers(logseq.settings?.taskMarkersComplete as string)
  );
  
  logseq.onSettingsChanged((_previousSettings, settings) => {
    TASK_MARKERS = new Set(splitTaskMarkers(settings?.taskMarkers as string));
    TASK_MARKERS_COMPLETE = new Set(splitTaskMarkers(settings?.taskMarkersComplete as string));
  });

  logseq.DB.onChanged(async (event) => {
    const taskBlock = event.blocks.find((block) =>
      block.marker ? TASK_MARKERS.has(block.marker) : false
    );

    if (!taskBlock) {
      return;
    }

    const hasCompletedProperty =
      taskBlock.properties?.[logseq.settings?.completedDateProperty as string];
    const hasTimeProperty =
      taskBlock.properties?.[logseq.settings?.completedTimeProperty as string];

    // We use `updateBlock` instead of `upsertBlockProperty` or `removeBlockProperty` due to issues with updating queries
    // using the latter functions. https://github.com/logseq/logseq/issues/9802
    if (TASK_MARKERS_COMPLETE.has(taskBlock.marker)) {
      const updateProperties = {};

      if (!hasCompletedProperty && logseq.settings?.includeDate) {
        const userConfigs = await logseq.App.getUserConfigs();
        let preferredDateFormat = userConfigs.preferredDateFormat;
        preferredDateFormat = preferredDateFormat.replace(/E{1,3}/, "EEE"); //handle same E, EE, or EEE bug
        const datePage = getDateForPage(new Date(), preferredDateFormat);

        updateProperties[logseq.settings?.completedDateProperty] = datePage;
      }

      if (!hasTimeProperty && logseq.settings?.includeTime) {
        const timeNow = dayjs().format(logseq.settings?.timeFormat as string);

        updateProperties[logseq.settings?.completedTimeProperty] = timeNow;
      }

      // Only update if there is something to change, to prevent triggering a rewrite for an unchanged block.
      if (Object.keys(updateProperties).length > 0) {
        logseq.Editor.updateBlock(
          taskBlock.uuid, 
          stripLogbookAndBlockProperties(taskBlock.content), 
          { 
            properties: { 
              ...taskBlock.properties, 
              ...updateProperties 
            } 
          }
        );
      }
    } else if (hasCompletedProperty || hasTimeProperty) {
      let propertiesAfterRemoval = { ...taskBlock.properties };

      if (hasCompletedProperty) {
        delete propertiesAfterRemoval[logseq.settings?.completedDateProperty as string];
      }

      if (hasTimeProperty) {
        delete propertiesAfterRemoval[logseq.settings?.completedTimeProperty as string];
      }

      logseq.Editor.updateBlock(
        taskBlock.uuid,
        stripLogbookAndBlockProperties(taskBlock.content),
        {
          properties: propertiesAfterRemoval
        }
      )
    }
  });

  logseq.Editor.registerSlashCommand(
    "Completed tasks for the past week",
    async () => {
      const block = await logseq.Editor.getCurrentBlock();
      if (!block) {
        return;
      }

      const userConfigs = await logseq.App.getUserConfigs();
      let preferredDateFormat = userConfigs.preferredDateFormat;
      preferredDateFormat = preferredDateFormat.replace(/E{1,3}/, "EEE"); //handle same E, EE, or EEE bug
      const today = dayjs(new Date());

      let query = "{{query (or ";
      const days: string[] = [];
      for (let i = 0; i < 7; i++) {
        days.push(
          `(property completed ${getDateForPage(
            today.subtract(i + 1, "day").toDate(),
            preferredDateFormat
          )})`
        );
      }
      query += days.join(" ");
      query += ") }}";

      const blockHeader = await logseq.Editor.insertBlock(
        block.uuid,
        "### Tasks completed last week",
        { before: true }
      );
      if (!blockHeader) {
        return;
      }
      await logseq.Editor.insertBlock(blockHeader.uuid, query);
      await logseq.Editor.insertBlock(blockHeader.uuid, "---", {
        sibling: true,
      });
    }
  );
}

logseq.ready(main).catch(console.error);
