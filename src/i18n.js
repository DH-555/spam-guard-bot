const STRINGS = {
  en: {
    moderation: {
      alertTitle: "Suspicious image blocked",
      alertDescription: "A suspicious image was detected.",
      alertContent: (tag) => `Moderation alert: ${tag}`,
      user: "User",
      channel: "Channel",
      message: "Message",
      imageSource: "Image source",
      timeout: (minutes) => `Timeout (${minutes} min)`,
      messageDeleted: "Message deleted",
      recognizedText: "Recognized text",
      detectionMethod: "Detection method",
      visualMatch: (label, distance) =>
        `Visual match: ${label} (distance ${distance})`,
      ocrMatch: "OCR keywords detected",
      easterEggMatch: "Easter egg OCR match",
      easterEggReply: "Hahaha I got it 😜",
      ocrSkipped: "(visual match, OCR skipped)",
      yes: "Yes",
      noPrefix: (reason) => `No: ${reason}`,
      emptyText: "(empty)",
      timeoutFailure:
        "The bot cannot apply a timeout because of permissions or role hierarchy.",
      fallbackNotice: (userMention) =>
        `Message deleted: ${userMention}. To receive alerts and detailed information, configure a moderation channel with \`/setup moderation-channel\`.`,
    },
    setup: {
      onlyInServer: "This command can only be used inside a server.",
      manageServerRequired:
        "You need the Manage Server permission to use this command.",
      missingBotPermissions:
        "The bot needs View Channel, Send Messages, and Embed Links permissions in the selected channel.",
      paranoiaSaved: (level) => `The paranoia level is now set to ${level}.`,
      timeoutSaved: (minutes) => `The timeout is now set to ${minutes} minutes.`,
      excludedRoleAdded: (role) => `The role ${role} is now excluded from detection.`,
      excludedRoleRemoved: (role) => `The role ${role} is no longer excluded from detection.`,
      excludedAdministratorsEnabled: "Server administrators are now excluded from detection.",
      excludedAdministratorsDisabled: "Server administrators are no longer excluded from detection.",
      excludedRolesList: (roles) => `Excluded roles: ${roles}`,
      saved: (channel) => `Moderation alerts will now be sent to ${channel}.`,
      currentSet: (channelId) =>
        `The moderation channel is currently set to <#${channelId}>.`,
      currentParanoia: (level) => `The paranoia level is currently set to ${level}.`,
      currentTimeout: (minutes) => `The timeout is currently set to ${minutes} minutes.`,
      currentExcludedRoles: (roles) => `Excluded roles: ${roles}`,
      excludedAdministratorsLabel: "admin",
      notConfigured:
        "No moderation channel has been configured. Use `/setup moderation-channel`.",
      configError: "The configuration could not be saved. Check the bot logs.",
      noExcludedRoles: "none",
      paranoiaLow: "low",
      paranoiaMedium: "medium",
      paranoiaHigh: "high",
      paranoiaExtreme: "extreme",
    },
  },
  es: {
    moderation: {
      alertTitle: "Se bloqueó una imagen sospechosa",
      alertDescription: "Se detectó una imagen sospechosa.",
      alertContent: (tag) => `Aviso de moderación: ${tag}`,
      user: "Usuario",
      channel: "Canal",
      message: "Mensaje",
      imageSource: "Origen de la imagen",
      timeout: (minutes) => `Expulsión temporal (${minutes} min)`,
      messageDeleted: "Mensaje borrado",
      recognizedText: "Texto reconocido",
      detectionMethod: "Método de detección",
      visualMatch: (label, distance) =>
        `Coincidencia visual: ${label} (distancia ${distance})`,
      ocrMatch: "Palabras clave detectadas por OCR",
      easterEggMatch: "Coincidencia OCR del easter egg",
      easterEggReply: "Jajaja, piqué.",
      ocrSkipped: "(coincidencia visual, OCR omitido)",
      yes: "Sí",
      noPrefix: (reason) => `No: ${reason}`,
      emptyText: "(vacío)",
      timeoutFailure:
        "El bot no puede aplicar una expulsión temporal por permisos o jerarquía de roles.",
      fallbackNotice: (userMention) =>
        `Mensaje borrado: ${userMention}. Para recibir alertas e información detallada, configura un canal de moderación con \`/setup moderation-channel\`.`,
    },
    setup: {
      onlyInServer: "Este comando solo puede usarse dentro de un servidor.",
      manageServerRequired:
        "Necesitas el permiso Gestionar servidor para usar este comando.",
      missingBotPermissions:
        "El bot necesita permisos de Ver canal, Enviar mensajes y Insertar enlaces en el canal seleccionado.",
      paranoiaSaved: (level) => `El nivel de paranoia ahora es ${level}.`,
      timeoutSaved: (minutes) => `El timeout ahora está configurado en ${minutes} minutos.`,
      excludedRoleAdded: (role) => `El rol ${role} ahora está excluido de la detección.`,
      excludedRoleRemoved: (role) => `El rol ${role} ya no está excluido de la detección.`,
      excludedAdministratorsEnabled:
        "Los administradores del servidor ahora están excluidos de la detección.",
      excludedAdministratorsDisabled:
        "Los administradores del servidor ya no están excluidos de la detección.",
      excludedRolesList: (roles) => `Roles excluidos: ${roles}`,
      saved: (channel) => `Las alertas de moderación se enviarán a ${channel}.`,
      currentSet: (channelId) =>
        `El canal de moderación está configurado actualmente en <#${channelId}>.`,
      currentParanoia: (level) =>
        `El nivel de paranoia está configurado actualmente en ${level}.`,
      currentTimeout: (minutes) =>
        `El timeout está configurado actualmente en ${minutes} minutos.`,
      currentExcludedRoles: (roles) => `Roles excluidos: ${roles}`,
      excludedAdministratorsLabel: "admin",
      notConfigured:
        "No se ha configurado ningún canal de moderación. Usa `/setup moderation-channel`.",
      configError:
        "No se pudo guardar la configuración. Revisa los registros del bot.",
      noExcludedRoles: "ninguno",
      paranoiaLow: "bajo",
      paranoiaMedium: "medio",
      paranoiaHigh: "alto",
      paranoiaExtreme: "extremo",
    },
  },
};

function normalizeLocale(locale) {
  if (typeof locale !== "string") {
    return "en";
  }

  return locale.toLowerCase().startsWith("es") ? "es" : "en";
}

export function resolveLocale(source) {
  return normalizeLocale(
    source?.guildLocale ?? source?.preferredLocale ?? source?.locale,
  );
}

export function t(locale, namespace, key, ...args) {
  const lang = STRINGS[normalizeLocale(locale)] ?? STRINGS.en;
  const value = lang[namespace]?.[key] ?? STRINGS.en[namespace]?.[key];

  if (typeof value === "function") {
    return value(...args);
  }

  return value ?? "";
}
