# Security policy

**English** · [Español](#política-de-seguridad)

## Supported versions

Only the [latest release](https://github.com/Hredo/ai-command-center/releases/latest)
gets security fixes. If you are on an older version, update first and check whether the
problem is still there.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub instead:

1. Go to the [Security tab](https://github.com/Hredo/ai-command-center/security) of this
   repository.
2. Click **Report a vulnerability**
   ([direct link](https://github.com/Hredo/ai-command-center/security/advisories/new)).

Only the maintainer can see the report. It helps to include:

- the version you tested and how you installed it (installer, portable zip or built
  from source);
- what an attacker can do, and what they need to have first;
- the steps to reproduce it, or a proof of concept.

This is a project maintained by one person in their free time, so there is no fixed
deadline. You will get an answer as soon as possible, and you will be told whether the
report is accepted, what the fix will be and when it ships. If you want to be credited in
the advisory, say so in the report.

## What is in scope

The application itself: the Electron main process, the renderer and the bridge between
them, how API keys are stored, the terminals and the agents it launches. The
[Security section of the README](README.md#security) describes the protections that are
meant to hold, such as the sandboxed renderer, validated IPC and keys encrypted with the
system's keyring (DPAPI on Windows, the Keychain on macOS, Secret Service on Linux).
A way around any of them counts as a vulnerability.

Out of scope: the third-party tools the app runs (Claude Code, Codex, OpenCode, Ollama…)
and the AI providers it talks to. Report those to their own maintainers.

---

# Política de seguridad

[English](#security-policy) · **Español**

## Versiones con soporte

Solo la [última versión](https://github.com/Hredo/ai-command-center/releases/latest)
recibe arreglos de seguridad. Si usas una anterior, actualiza primero y comprueba si el
fallo sigue ahí.

## Cómo avisar de una vulnerabilidad

**No abras un issue público.** Avisa en privado desde GitHub:

1. Entra en la [pestaña Security](https://github.com/Hredo/ai-command-center/security) de
   este repositorio.
2. Pulsa **Report a vulnerability**
   ([enlace directo](https://github.com/Hredo/ai-command-center/security/advisories/new)).

El aviso solo lo ve el responsable del proyecto. Ayuda mucho incluir:

- la versión que probaste y cómo la instalaste (instalador, zip portátil o compilada);
- qué puede hacer un atacante y qué necesita tener antes;
- los pasos para reproducirlo o una prueba de concepto.

Es un proyecto que mantiene una sola persona en su tiempo libre, así que no hay un plazo
fijo. Recibirás respuesta lo antes posible, y se te dirá si el aviso se acepta, cuál será
el arreglo y cuándo sale. Si quieres aparecer en el aviso publicado, dilo en tu mensaje.

## Qué entra

La aplicación en sí: el proceso principal de Electron, la ventana y el puente entre los
dos, cómo se guardan las claves de API, las terminales y los agentes que lanza. La
[sección de Seguridad del README](README.es.md#seguridad) describe lo que debe aguantar,
como la ventana aislada, los mensajes IPC validados y las claves cifradas con el llavero del
sistema (DPAPI en Windows, el Llavero en macOS, Secret Service en Linux).
Saltarse cualquiera de esas protecciones cuenta como vulnerabilidad.

No entran: las herramientas de terceros que ejecuta (Claude Code, Codex, OpenCode,
Ollama…) ni los proveedores de IA con los que habla. Eso hay que reportarlo a quien las
mantiene.
