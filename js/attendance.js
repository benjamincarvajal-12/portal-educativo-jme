(() => {
    "use strict";

    const STORAGE_KEY = "jme.portal.attendance.v1";
    const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
    const STATES = ["present", "late", "absent", "excused", "holiday"];
    const STATE_INFO = {
        present: { label: "Presente", icon: "🟢", short: "P" },
        late: { label: "Tardanza", icon: "🟡", short: "T" },
        absent: { label: "Ausente", icon: "🔴", short: "A" },
        excused: { label: "Ausencia justificada", icon: "🔵", short: "J" },
        holiday: { label: "Feriado", icon: "🟣", short: "F" }
    };
    const MONTHS = [
        { value: "03", label: "Marzo" }, { value: "04", label: "Abril" },
        { value: "05", label: "Mayo" }, { value: "06", label: "Junio" },
        { value: "08", label: "Agosto" }, { value: "09", label: "Septiembre" },
        { value: "10", label: "Octubre" }, { value: "11", label: "Noviembre" },
        { value: "12", label: "Diciembre" }
    ];
    const DEMO_STUDENTS = [
        ["curso1", "student-juan", "Juan Pérez", "juan.perez@example.test", "Regular"],
        ["curso1", "student-maria", "María Gómez", "maria.gomez@example.test", "Regular"],
        ["curso2", "student-valentina", "Valentina Ruiz", "valentina.ruiz@example.test", "Regular"],
        ["curso2", "student-tomas", "Tomás Castro", "tomas.castro@example.test", "Regular"],
        ["curso3", "student-camila", "Camila Torres", "camila.torres@example.test", "Regular"],
        ["curso3", "student-benjamin", "Benjamín Díaz", "benjamin.diaz@example.test", "Regular"],
        ["curso4", "student-sofia", "Sofía Luna", "sofia.luna@example.test", "Regular"],
        ["curso4", "student-mateo", "Mateo Silva", "mateo.silva@example.test", "Regular"],
        ["curso5", "student-valeria", "Valeria Costa", "valeria.costa@example.test", "Regular"],
        ["curso5", "student-lucas", "Lucas Medina", "lucas.medina@example.test", "Regular"]
    ].map(([courseId, id, name, email, academicStatus]) => ({ courseId, id, name, email, academicStatus }));
    let remoteUnsubscribers = [];

    function readStore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const store = JSON.parse(raw);
                if (Array.isArray(store.students) && store.records && typeof store.records === "object") return store;
            }
        } catch (error) {
            console.warn("No se pudo leer el libro de asistencia local.", error);
        }

        const demoRecord = {
            "student-juan": { "0": "present", "1": "late", "2": "absent", "3": "present", "4": "excused" },
            "student-maria": { "0": "present", "1": "present", "2": "present", "3": "holiday", "4": "present" }
        };
        const initial = {
            version: 1,
            students: DEMO_STUDENTS,
            records: { "2026-10-w5": demoRecord }
        };
        writeStore(initial);
        return initial;
    }

    function writeStore(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
            return true;
        } catch (error) {
            console.warn("No se pudo guardar el libro de asistencia local.", error);
            return false;
        }
    }

    async function persistStore(store) {
        const services = await window.JMEFirebaseReady;
        const user = services.auth.currentUser;
        if (!user) throw new Error("Inicia sesión con una cuenta autorizada para guardar la asistencia.");
        const profile = await services.db.collection("users").doc(user.uid).get();
        if (!profile.exists || !services.isStaff(profile.data().role)) {
            throw new Error("Solo el personal autorizado puede guardar la asistencia.");
        }

        const studentCollection = services.db.collection("students");
        const existingStudents = await studentCollection.get();
        const batch = services.db.batch();
        store.students.forEach((student) => batch.set(studentCollection.doc(student.id), student));
        existingStudents.docs.forEach((document) => {
            if (!store.students.some((student) => student.id === document.id)) batch.delete(document.ref);
        });
        await batch.commit();

        const attendanceCollection = services.db.collection("attendance");
        const existingWeeks = await attendanceCollection.get();
        const weekBatch = services.db.batch();
        Object.entries(store.records).forEach(([weekKey, records]) => {
            weekBatch.set(attendanceCollection.doc(weekKey), { records, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        });
        existingWeeks.docs.forEach((document) => {
            if (!Object.hasOwn(store.records, document.id)) weekBatch.delete(document.ref);
        });
        await weekBatch.commit();
    }

    async function getStaffServices() {
        const services = await window.JMEFirebaseReady;
        const user = services.auth.currentUser;
        if (!user) throw new Error("Inicia sesión con una cuenta autorizada para guardar los cambios.");
        const profile = await services.db.collection("users").doc(user.uid).get();
        if (!profile.exists || !services.isStaff(profile.data().role)) {
            throw new Error("Solo el personal autorizado puede modificar estos datos.");
        }
        return services;
    }

    async function persistStatus(root, studentId, dayIndex) {
        const services = await getStaffServices();
        const weekKey = makeWeekKey(root.dataset.year, root.dataset.month, root.dataset.week);
        const reference = services.db.collection("attendance").doc(weekKey);
        await services.db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(reference);
            const records = snapshot.exists ? snapshot.data().records || {} : {};
            records[studentId] ||= {};
            const current = records[studentId][dayIndex] || "";
            const nextIndex = current ? (STATES.indexOf(current) + 1) % STATES.length : 0;
            records[studentId][dayIndex] = STATES[nextIndex];
            transaction.set(reference, { records, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        });
    }

    async function persistHoliday(root, students, dayIndex, clear) {
        const services = await getStaffServices();
        const weekKey = makeWeekKey(root.dataset.year, root.dataset.month, root.dataset.week);
        const reference = services.db.collection("attendance").doc(weekKey);
        await services.db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(reference);
            const records = snapshot.exists ? snapshot.data().records || {} : {};
            students.forEach((student) => {
                records[student.id] ||= {};
                if (clear) delete records[student.id][dayIndex];
                else records[student.id][dayIndex] = "holiday";
                if (!Object.keys(records[student.id]).length) delete records[student.id];
            });
            transaction.set(reference, { records, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        });
    }

    function subscribeAttendanceToCloud() {
        window.JMEFirebaseReady.then((services) => {
            services.auth.onAuthStateChanged(async (user) => {
                remoteUnsubscribers.forEach((unsubscribe) => unsubscribe());
                remoteUnsubscribers = [];
                if (!user) return;
                try {
                    const profileSnapshot = await services.db.collection("users").doc(user.uid).get();
                    if (!profileSnapshot.exists) return;
                    const isStaff = services.isStaff(profileSnapshot.data().role);
                    let studentsReady = false;
                    let weeksReady = false;
                    let seeded = false;
                    const seedIfEmpty = () => {
                        if (!isStaff || seeded || !studentsReady || !weeksReady) return;
                        if (remoteStudentCount || remoteWeekCount) return;
                        seeded = true;
                        persistStore(readStore()).catch((error) => services.reportError(error));
                    };
                    let remoteStudentCount = 0;
                    let remoteWeekCount = 0;
                    remoteUnsubscribers.push(services.db.collection("students").onSnapshot((snapshot) => {
                        studentsReady = true;
                        remoteStudentCount = snapshot.size;
                        if (snapshot.size) {
                            const store = readStore();
                            store.students = snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
                            writeStore(store);
                            refreshAllAttendance();
                        }
                        seedIfEmpty();
                    }, services.reportError));
                    remoteUnsubscribers.push(services.db.collection("attendance").onSnapshot((snapshot) => {
                        weeksReady = true;
                        remoteWeekCount = snapshot.size;
                        if (snapshot.size) {
                            const store = readStore();
                            store.records = Object.fromEntries(snapshot.docs.map((document) => [document.id, document.data().records || {}]));
                            writeStore(store);
                            refreshAllAttendance();
                        }
                        seedIfEmpty();
                    }, services.reportError));
                } catch (error) {
                    services.reportError(error);
                }
            });
        }).catch((error) => console.error("No se pudo iniciar la sincronización de asistencia.", error));
    }

    function makeId() {
        return globalThis.crypto?.randomUUID?.() || `student-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function makeWeekKey(year, month, week) {
        return `${year}-${month}-w${week}`;
    }

    function formatPercent(value) {
        return `${value.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    }

    function getRole(root) {
        return root.dataset.role || document.body.dataset.dashboardRole || "student";
    }

    function canEdit(role) {
        return ["preceptor", "director", "admin"].includes(role);
    }

    function canManageStudents(role) {
        return ["admin", "director", "preceptor"].includes(role);
    }

    function canExport(role) {
        return role === "admin" || role === "director";
    }

    function buildMonthOptions(select) {
        MONTHS.forEach((month) => select.append(new Option(month.label, month.value)));
    }

    function getInitialPeriod() {
        const now = new Date();
        const activeMonth = MONTHS.some((month) => month.value === String(now.getMonth() + 1).padStart(2, "0"));
        const month = activeMonth ? String(now.getMonth() + 1).padStart(2, "0") : "03";
        const week = activeMonth ? Math.min(5, Math.max(1, Math.ceil(now.getDate() / 7))) : 1;
        return { year: now.getFullYear(), month, week };
    }

    function countStates(records, students, courseId, year, studentId) {
        const totals = { present: 0, late: 0, absent: 0, excused: 0, holiday: 0 };
        const studentCourse = new Map(students.map((student) => [student.id, student.courseId]));
        Object.entries(records).forEach(([key, dayRecords]) => {
            if (!key.startsWith(`${year}-`)) return;
            Object.entries(dayRecords).forEach(([recordStudentId, statuses]) => {
                if (studentId && recordStudentId !== studentId) return;
                if (courseId !== "todos" && studentCourse.get(recordStudentId) !== courseId) return;
                Object.values(statuses).forEach((state) => {
                    if (STATES.includes(state)) totals[state] += 1;
                });
            });
        });
        return totals;
    }

    function getPercent(totals) {
        const scheduled = totals.present + totals.late + totals.absent + totals.excused;
        if (!scheduled) return 0;
        return ((totals.present + totals.late + totals.excused) / scheduled) * 100;
    }

    function renderSummary(root, store, courseId) {
        const stats = root.querySelector("[data-att-stats]");
        if (!stats) return;
        stats.replaceChildren();
        const students = store.students.filter((student) => courseId === "todos" || student.courseId === courseId);
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const week = Math.min(5, Math.max(1, Math.ceil(now.getDate() / 7)));
        const currentWeek = store.records[makeWeekKey(year, month, week)] || {};
        const day = now.getDay() === 0 || now.getDay() === 6 ? -1 : now.getDay() - 1;
        const todays = students.reduce((counts, student) => {
            const status = day < 0 ? "" : currentWeek[student.id]?.[day];
            if (status && status !== "holiday") counts[status] = (counts[status] || 0) + 1;
            return counts;
        }, {});
        const annual = countStates(store.records, store.students, courseId, year);
        const summary = [
            ["👥", "Total alumnos", students.length, "stat-blue"],
            ["🟢", "Presentes hoy", todays.present || 0, "stat-green"],
            ["🟡", "Tardanzas hoy", todays.late || 0, "stat-yellow"],
            ["🔴", "Ausentes hoy", todays.absent || 0, "stat-red"],
            ["🔵", "Justificados hoy", todays.excused || 0, "stat-cyan"],
            ["📊", "Asistencia general", formatPercent(getPercent(annual)), "stat-indigo"]
        ];
        summary.forEach(([icon, label, value, color]) => {
            const card = document.createElement("article");
            card.className = `att-stat ${color}`;
            const iconNode = document.createElement("span");
            iconNode.setAttribute("aria-hidden", "true");
            iconNode.textContent = icon;
            const labelNode = document.createElement("span");
            labelNode.className = "att-stat-label";
            labelNode.textContent = label;
            const valueNode = document.createElement("strong");
            valueNode.className = "att-stat-value";
            valueNode.textContent = String(value);
            card.append(iconNode, labelNode, valueNode);
            stats.append(card);
        });
    }

    function updateStudentFilter(select, students, selected) {
        select.replaceChildren(new Option("Todo el alumnado", "todos"));
        students.forEach((student) => select.append(new Option(student.name, student.id)));
        if (Array.from(select.options).some((option) => option.value === selected)) select.value = selected;
    }

    function renderTable(root, store, options) {
        const table = root.querySelector("[data-att-table]");
        if (!table) return;
        const { role, courseId, year, month, week, query, studentFilter } = options;
        const dayKey = makeWeekKey(year, month, week);
        const dayRecords = store.records[dayKey] || {};
        const allStudents = store.students.filter((student) => courseId === "todos" || student.courseId === courseId);
        const search = query.trim().toLocaleLowerCase("es");
        const students = allStudents.filter((student) => {
            const course = window.JMEAttendanceCourseName?.(student.courseId) || student.courseId;
            const matchesSearch = !search || `${student.name} ${student.email} ${course}`.toLocaleLowerCase("es").includes(search);
            const matchesStudent = studentFilter === "todos" || student.id === studentFilter;
            return matchesSearch && matchesStudent;
        });

        const head = document.createElement("thead");
        const header = document.createElement("tr");
        const studentHeading = document.createElement("th");
        studentHeading.scope = "col";
        studentHeading.textContent = "Alumno";
        header.append(studentHeading);
        DAYS.forEach((day, dayIndex) => {
            const th = document.createElement("th");
            th.scope = "col";
            const label = document.createElement("span");
            label.textContent = day;
            th.append(label);
            if (canEdit(role)) {
                const holiday = document.createElement("button");
                holiday.type = "button";
                holiday.className = "att-holiday-action";
                holiday.dataset.attAction = "holiday-day";
                holiday.dataset.day = String(dayIndex);
                const everyoneHoliday = students.length > 0 && students.every((student) => dayRecords[student.id]?.[dayIndex] === "holiday");
                holiday.textContent = everyoneHoliday ? "Quitar feriado" : "Marcar feriado";
                holiday.setAttribute("aria-label", `${everyoneHoliday ? "Quitar feriado de" : "Marcar como feriado"} ${day}`);
                th.append(holiday);
            }
            header.append(th);
        });
        head.append(header);

        const body = document.createElement("tbody");
        if (!students.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = DAYS.length + 1;
            cell.className = "empty-state";
            cell.textContent = "No hay alumnos que coincidan con los filtros.";
            row.append(cell);
            body.append(row);
        }
        students.forEach((student) => {
            const row = document.createElement("tr");
            const nameCell = document.createElement("th");
            nameCell.scope = "row";
            nameCell.className = "att-student-name";
            const name = document.createElement("span");
            name.textContent = student.name;
            const academic = document.createElement("small");
            academic.textContent = student.academicStatus || "Regular";
            nameCell.append(name, academic);
            row.append(nameCell);
            DAYS.forEach((day, dayIndex) => {
                const cell = document.createElement("td");
                const status = dayRecords[student.id]?.[dayIndex] || "";
                const button = document.createElement("button");
                button.type = "button";
                button.className = `att-status status-${status || "unmarked"}`;
                button.dataset.attAction = "cycle-status";
                button.dataset.studentId = student.id;
                button.dataset.day = String(dayIndex);
                button.dataset.state = status;
                button.disabled = !canEdit(role);
                button.title = `${student.name}, ${day}: ${status ? STATE_INFO[status].label : "Sin registrar"}${canEdit(role) ? ". Cambiar estado" : ""}`;
                button.setAttribute("aria-label", button.title);
                button.textContent = status ? STATE_INFO[status].icon : "—";
                cell.append(button);
                row.append(cell);
            });
            body.append(row);
        });
        table.replaceChildren(head, body);
    }

    function renderRoster(root, store, courseId, role, query) {
        const container = root.querySelector("[data-att-roster]");
        if (!container) return;
        container.replaceChildren();
        const search = query.trim().toLocaleLowerCase("es");
        const students = store.students.filter((student) => {
            const matchesCourse = courseId === "todos" || student.courseId === courseId;
            const courseName = window.JMEAttendanceCourseName?.(student.courseId) || student.courseId;
            return matchesCourse && (!search || `${student.name} ${student.email} ${courseName}`.toLocaleLowerCase("es").includes(search));
        });
        if (!students.length) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = "No hay alumnos en esta vista.";
            container.append(empty);
            return;
        }
        students.forEach((student) => {
            const card = document.createElement("article");
            card.className = "att-roster-card";
            const info = document.createElement("div");
            const name = document.createElement("h3");
            name.textContent = student.name;
            info.append(name);
            if (role !== "student") {
                const email = document.createElement("p");
                email.textContent = student.email || "Sin correo registrado";
                const status = document.createElement("span");
                status.className = "badge";
                status.textContent = student.academicStatus || "Regular";
                info.append(email, status);
            }
            const actions = document.createElement("div");
            actions.className = "att-roster-actions";
            const profile = document.createElement("a");
            profile.className = "button secondary small";
            profile.href = `perfil-alumno.html?curso=${encodeURIComponent(student.courseId)}&alumno=${encodeURIComponent(student.id)}`;
            profile.textContent = "Ver asistencia";
            actions.append(profile);
            if (canManageStudents(role)) {
                const edit = document.createElement("button");
                edit.type = "button";
                edit.className = "button secondary small";
                edit.dataset.attAction = "edit-student";
                edit.dataset.studentId = student.id;
                edit.textContent = "Editar";
                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "button danger small";
                remove.dataset.attAction = "delete-student";
                remove.dataset.studentId = student.id;
                remove.textContent = "Eliminar";
                actions.append(edit, remove);
            }
            card.append(info, actions);
            container.append(card);
        });
    }

    function buildControl(labelText, control) {
        const field = document.createElement("label");
        field.className = "att-filter-field";
        const label = document.createElement("span");
        label.textContent = labelText;
        field.append(label, control);
        return field;
    }

    function makeSelect(name, className = "control") {
        const select = document.createElement("select");
        select.className = className;
        select.dataset.attFilter = name;
        return select;
    }

    function renderAttendanceEntry(root, courses) {
        root.replaceChildren();
        const heading = document.createElement("div");
        heading.className = "att-heading";
        const headingText = document.createElement("div");
        const eyebrow = document.createElement("p");
        eyebrow.className = "eyebrow";
        eyebrow.textContent = "Primer año · Cinco cursos";
        const title = document.createElement("h2");
        title.className = "section-title";
        const description = document.createElement("p");
        description.className = "section-copy";
        headingText.append(eyebrow, title, description);
        heading.append(headingText);
        root.append(heading);

        if (root.dataset.attendanceStep !== "courses") {
            title.textContent = "Asistencia de los alumnos";
            description.textContent = "Consulta el registro de asistencia de los cinco cursos de primer año.";

            const explanation = document.createElement("div");
            explanation.className = "att-intro-panel";
            const explanationTitle = document.createElement("h3");
            explanationTitle.textContent = "¿Qué es el registro de asistencia?";
            const explanationText = document.createElement("p");
            explanationText.textContent = "Es el libro digital donde se registra la asistencia diaria de cada alumno: presente, tardanza, ausente, ausencia justificada o feriado.";
            const usageText = document.createElement("p");
            usageText.textContent = "Las marcas se organizan por curso, mes y semana. El personal autorizado puede registrar y consultar los datos; los alumnos pueden observarlos sin modificarlos.";
            const storageText = document.createElement("p");
            storageText.textContent = "En esta versión de demostración, los cambios se guardan automáticamente en el almacenamiento local de este navegador y solo se ven aquí. No se sincronizan entre dispositivos ni reemplazan un registro institucional.";
            explanation.append(explanationTitle, explanationText, usageText, storageText);

            const open = document.createElement("button");
            open.type = "button";
            open.className = "button att-primary-action";
            open.dataset.attAction = "open-courses";
            open.textContent = "asistencia de los alumnos";
            root.append(explanation, open);
            return;
        }

        title.textContent = "Elegí un curso de primer año";
        description.textContent = "Selecciona uno de los cinco cursos para ver sus asistencias.";
        const picker = document.createElement("div");
        picker.className = "att-course-picker";
        courses.forEach((course) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "button secondary att-course-button";
            button.dataset.attAction = "select-course";
            button.dataset.courseId = course.id;
            button.textContent = course.name;
            picker.append(button);
        });
        const back = document.createElement("button");
        back.type = "button";
        back.className = "button secondary small";
        back.dataset.attAction = "back-to-intro";
        back.textContent = "Volver";
        root.append(picker, back);
    }

    function renderAttendanceApp(root) {
        const store = readStore();
        const role = getRole(root);
        const dashboardRole = ["admin", "director", "preceptor"].includes(role);
        const dashboardView = root.dataset.view === "dashboard";
        const courses = window.JMEAttendanceGetCourses?.() || [];
        if (dashboardView && !root.dataset.courseId) {
            renderAttendanceEntry(root, courses);
            return;
        }
        const period = getInitialPeriod();
        const year = Number(root.dataset.year || period.year);
        const month = root.dataset.month || period.month;
        const week = Math.min(5, Math.max(1, Number(root.dataset.week || period.week)));
        const query = root.dataset.search || "";
        const studentFilter = root.dataset.studentFilter || "todos";
        let courseId = root.dataset.courseId || "";
        if (!courseId) courseId = courses[0]?.id || "curso1";
        root.dataset.year = String(year);
        root.dataset.month = month;
        root.dataset.week = String(week);
        root.dataset.selectedCourse = courseId;
        const selectedWeekKey = makeWeekKey(year, month, week);
        if (!Object.hasOwn(store.records, selectedWeekKey)) {
            store.records[selectedWeekKey] = {};
            writeStore(store);
        }

        root.replaceChildren();
        const heading = document.createElement("div");
        heading.className = "att-heading";
        const headingText = document.createElement("div");
        const eyebrow = document.createElement("p");
        eyebrow.className = "eyebrow";
        eyebrow.textContent = "Libro digital de clase";
        const title = document.createElement("h2");
        title.className = "section-title";
        title.textContent = `👥 Asistencia · ${courses.find((course) => course.id === courseId)?.name || courseId}`;
        const subtitle = document.createElement("p");
        subtitle.className = "section-copy";
        subtitle.textContent = "Historial por semana · Estados guardados automáticamente en este navegador";
        headingText.append(eyebrow, title, subtitle);
        heading.append(headingText);
        root.append(heading);

        if (dashboardView) {
            const navigation = document.createElement("div");
            navigation.className = "button-row att-navigation";
            const changeCourse = document.createElement("button");
            changeCourse.type = "button";
            changeCourse.className = "button secondary small";
            changeCourse.dataset.attAction = "change-course";
            changeCourse.textContent = "Cambiar curso";
            const toggleRoster = document.createElement("button");
            toggleRoster.type = "button";
            toggleRoster.className = "button secondary small";
            toggleRoster.dataset.attAction = root.dataset.attendanceView === "roster" ? "show-attendance" : "show-roster";
            toggleRoster.textContent = root.dataset.attendanceView === "roster" ? "Ver asistencia del curso" : "Listado de alumnos";
            navigation.append(changeCourse, toggleRoster);
            root.append(navigation);
        }

        const demoNote = document.createElement("p");
        demoNote.className = "att-demo-note";
        demoNote.textContent = "Alumnos y marcas iniciales de ejemplo. No cargues datos reales hasta integrar autenticación y almacenamiento institucional.";
        root.append(demoNote);

        const controls = document.createElement("div");
        controls.className = "att-controls";
        if (dashboardRole && root.dataset.courseId === undefined) {
            const courseSelect = makeSelect("course");
            courseSelect.append(new Option("Todos los cursos", "todos"));
            courses.forEach((course) => courseSelect.append(new Option(course.name, course.id)));
            courseSelect.value = courseId;
            controls.append(buildControl("Curso", courseSelect));
        }
        const yearSelect = makeSelect("year");
        [year - 1, year, year + 1].forEach((optionYear) => yearSelect.append(new Option(String(optionYear), String(optionYear))));
        yearSelect.value = String(year);
        const monthSelect = makeSelect("month");
        buildMonthOptions(monthSelect);
        monthSelect.value = month;
        const studentSelect = makeSelect("student");
        const studentsInCourse = store.students.filter((student) => courseId === "todos" || student.courseId === courseId);
        updateStudentFilter(studentSelect, studentsInCourse, studentFilter);
        const searchInput = document.createElement("input");
        searchInput.type = "search";
        searchInput.className = "control";
        searchInput.placeholder = "Buscar nombre, apellido o curso";
        searchInput.setAttribute("aria-label", "Buscar nombre, apellido o curso");
        searchInput.dataset.attFilter = "search";
        searchInput.value = query;
        controls.append(buildControl("Año", yearSelect), buildControl("Mes", monthSelect), buildControl("Alumno", studentSelect), buildControl("Buscar", searchInput));
        root.append(controls);

        const recess = document.createElement("div");
        recess.className = "att-recess";
        recess.innerHTML = "<span aria-hidden='true'>🏖</span><strong>Julio · Receso Invernal</strong><span>Sin semanas lectivas</span>";
        root.append(recess);

        const weekBar = document.createElement("div");
        weekBar.className = "att-week-bar";
        const weekLabel = document.createElement("span");
        weekLabel.className = "att-week-label";
        weekLabel.textContent = "Semana";
        weekBar.append(weekLabel);
        for (let weekNumber = 1; weekNumber <= 5; weekNumber += 1) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `att-week-button${weekNumber === week ? " is-active" : ""}`;
            button.dataset.attAction = "select-week";
            button.dataset.week = String(weekNumber);
            button.setAttribute("aria-pressed", String(weekNumber === week));
            button.textContent = `Semana ${weekNumber}`;
            weekBar.append(button);
        }
        root.append(weekBar);

        const legend = document.createElement("div");
        legend.className = "att-legend";
        STATES.forEach((state) => {
            const item = document.createElement("span");
            item.className = `att-legend-item status-${state}`;
            item.textContent = `${STATE_INFO[state].icon} ${STATE_INFO[state].label}`;
            legend.append(item);
        });
        root.append(legend);

        const stats = document.createElement("div");
        stats.className = "att-stats-grid";
        stats.dataset.attStats = "true";
        root.append(stats);
        renderSummary(root, store, courseId);

        const annual = countStates(store.records, store.students, courseId, year);
        const annualSummary = document.createElement("div");
        annualSummary.className = "att-annual-summary";
        const annualHeading = document.createElement("h3");
        annualHeading.textContent = `Acumulado anual ${year}`;
        annualSummary.append(annualHeading);
        [["🟢 Presentes", annual.present], ["🟡 Tardanzas", annual.late], ["🔴 Ausencias", annual.absent], ["🔵 Justificadas", annual.excused], ["📊 Asistencia", formatPercent(getPercent(annual))]].forEach(([label, value]) => {
            const item = document.createElement("div");
            item.className = "att-annual-total";
            const name = document.createElement("span");
            name.textContent = label;
            const total = document.createElement("strong");
            total.textContent = String(value);
            item.append(name, total);
            annualSummary.append(item);
        });
        root.append(annualSummary);

        const tablePanel = document.createElement("section");
        tablePanel.className = "att-table-panel";
        const tableTitle = document.createElement("div");
        tableTitle.className = "section-heading";
        const tableHeading = document.createElement("h3");
        tableHeading.className = "section-title";
        tableHeading.textContent = `📂 Historial de Asistencia · ${MONTHS.find((item) => item.value === month)?.label} · Semana ${week}`;
        tableTitle.append(tableHeading);
        if (canExport(role)) {
            const exports = document.createElement("div");
            exports.className = "button-row att-export-actions";
            const pdf = document.createElement("button");
            pdf.type = "button";
            pdf.className = "button secondary small";
            pdf.dataset.attAction = "export-pdf";
            pdf.textContent = "📄 Exportar PDF";
            const excel = document.createElement("button");
            excel.type = "button";
            excel.className = "button secondary small";
            excel.dataset.attAction = "export-excel";
            excel.textContent = "📊 Exportar Excel";
            exports.append(pdf, excel);
            tableTitle.append(exports);
        } else if (role === "preceptor") {
            const exports = document.createElement("div");
            exports.className = "button-row att-export-actions";
            const report = document.createElement("button");
            report.type = "button";
            report.className = "button secondary small";
            report.dataset.attAction = "export-week";
            report.textContent = "📄 Generar reporte semanal";
            exports.append(report);
            tableTitle.append(exports);
        }
        tablePanel.append(tableTitle);
        const tableWrap = document.createElement("div");
        tableWrap.className = "table-wrap att-table-wrap";
        const table = document.createElement("table");
        table.className = "data-table att-table";
        table.dataset.attTable = "true";
        tableWrap.append(table);
        tablePanel.append(tableWrap);
        const note = document.createElement("p");
        note.className = "att-calculation-note";
        note.textContent = "El porcentaje suma presentes, tardanzas y ausencias justificadas. Las ausencias injustificadas descuentan; los feriados se excluyen del cálculo. Las celdas vacías todavía no tienen registro.";
        tablePanel.append(note);
        root.append(tablePanel);
        renderTable(root, store, { role, courseId, year, month, week, query, studentFilter });

        const rosterHeading = document.createElement("div");
        rosterHeading.className = "section-heading att-roster-heading";
        const rosterTitle = document.createElement("h3");
        rosterTitle.className = "section-title";
        rosterTitle.textContent = "📋 Listado de alumnos";
        rosterHeading.append(rosterTitle);
        root.append(rosterHeading);

        if (canManageStudents(role)) {
            const form = document.createElement("form");
            form.className = "att-student-form";
            form.dataset.attStudentForm = "true";
            const id = document.createElement("input");
            id.type = "hidden";
            id.name = "student-id";
            const courseSelect = document.createElement("select");
            courseSelect.className = "control";
            courseSelect.name = "student-course";
            courses.forEach((course) => courseSelect.append(new Option(course.name, course.id)));
            courseSelect.value = courseId === "todos" ? (courses[0]?.id || "curso1") : courseId;
            const name = document.createElement("input");
            name.className = "control";
            name.name = "student-name";
            name.placeholder = "Nombre completo";
            name.required = true;
            const email = document.createElement("input");
            email.className = "control";
            email.type = "email";
            email.name = "student-email";
            email.placeholder = "Correo electrónico";
            const academic = document.createElement("select");
            academic.className = "control";
            academic.name = "student-status";
            ["Regular", "En seguimiento", "Egresado/a"].forEach((status) => academic.append(new Option(status, status)));
            const submit = document.createElement("button");
            submit.type = "submit";
            submit.className = "button";
            submit.textContent = "Agregar alumno";
            form.append(id, buildControl("Curso", courseSelect), buildControl("Nombre completo", name), buildControl("Correo", email), buildControl("Estado académico", academic), submit);
            root.append(form);
        }
        const roster = document.createElement("div");
        roster.className = "att-roster-grid";
        roster.dataset.attRoster = "true";
        root.append(roster);
        renderRoster(root, store, courseId, role, query);

        const showingRoster = root.dataset.attendanceView === "roster";
        root.querySelectorAll(".att-controls, .att-recess, .att-week-bar, .att-legend, [data-att-stats], .att-annual-summary, .att-table-panel")
            .forEach((section) => { section.hidden = showingRoster; });
        root.querySelectorAll(".att-roster-heading, [data-att-student-form], [data-att-roster]")
            .forEach((section) => { section.hidden = !showingRoster; });
    }

    function refreshAllAttendance() {
        document.querySelectorAll("[data-attendance-app]").forEach((root) => renderAttendanceApp(root));
        renderStudentProfile();
    }

    function cycleStatus(root, studentId, dayIndex) {
        const store = readStore();
        const key = makeWeekKey(root.dataset.year, root.dataset.month, root.dataset.week);
        store.records[key] ||= {};
        store.records[key][studentId] ||= {};
        const current = store.records[key][studentId][dayIndex] || "";
        const nextIndex = current ? (STATES.indexOf(current) + 1) % STATES.length : 0;
        store.records[key][studentId][dayIndex] = STATES[nextIndex];
        if (writeStore(store)) {
            refreshAllAttendance();
            persistStatus(root, studentId, dayIndex).catch((error) => window.JMEFirebase?.reportError(error));
        }
    }

    function markDayHoliday(root, dayIndex) {
        const store = readStore();
        const courseId = root.dataset.courseId || root.dataset.selectedCourse || "todos";
        const students = store.students.filter((student) => courseId === "todos" || student.courseId === courseId);
        const key = makeWeekKey(root.dataset.year, root.dataset.month, root.dataset.week);
        store.records[key] ||= {};
        const clear = students.length > 0 && students.every((student) => store.records[key][student.id]?.[dayIndex] === "holiday");
        students.forEach((student) => {
            store.records[key][student.id] ||= {};
            if (clear) delete store.records[key][student.id][dayIndex];
            else store.records[key][student.id][dayIndex] = "holiday";
        });
        if (writeStore(store)) {
            refreshAllAttendance();
            persistHoliday(root, students, dayIndex, clear).catch((error) => window.JMEFirebase?.reportError(error));
        }
    }

    async function handleStudentSubmit(form) {
        const store = readStore();
        const values = new FormData(form);
        const id = String(values.get("student-id") || "");
        const student = {
            id: id || makeId(),
            courseId: String(values.get("student-course") || "curso1"),
            name: String(values.get("student-name") || "").trim(),
            email: String(values.get("student-email") || "").trim(),
            academicStatus: String(values.get("student-status") || "Regular")
        };
        if (id) store.students = store.students.map((item) => item.id === id ? student : item);
        else store.students.push(student);
        if (!writeStore(store)) return;
        refreshAllAttendance();
        const services = await getStaffServices();
        await services.db.collection("students").doc(student.id).set(student);
    }

    function editStudent(root, id) {
        const store = readStore();
        const student = store.students.find((item) => item.id === id);
        const form = root.querySelector("[data-att-student-form]");
        if (!student || !form) return;
        form.elements.namedItem("student-id").value = student.id;
        form.elements.namedItem("student-course").value = student.courseId;
        form.elements.namedItem("student-name").value = student.name;
        form.elements.namedItem("student-email").value = student.email;
        form.elements.namedItem("student-status").value = student.academicStatus || "Regular";
        form.querySelector("[type='submit']").textContent = "Guardar cambios";
        form.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    async function deleteStudent(id) {
        if (!window.confirm("¿Eliminar este alumno y conservar su historial? El historial se conservará, pero el alumno dejará de aparecer en el curso.")) return;
        const store = readStore();
        store.students = store.students.filter((student) => student.id !== id);
        if (!writeStore(store)) return;
        refreshAllAttendance();
        getStaffServices()
            .then((services) => services.db.collection("students").doc(id).delete())
            .catch((error) => window.JMEFirebase?.reportError(error));
    }

    function exportRows() {
        const store = readStore();
        const courseNames = new Map((window.JMEAttendanceGetCourses?.() || []).map((course) => [course.id, course.name]));
        const rows = [["Año", "Mes", "Semana", "Curso", "Alumno", "Correo", "Día", "Estado"]];
        Object.entries(store.records).sort(([left], [right]) => left.localeCompare(right)).forEach(([key, dayRecords]) => {
            const match = key.match(/^(\d{4})-(\d{2})-w(\d)$/);
            if (!match) return;
            Object.entries(dayRecords).forEach(([studentId, days]) => {
                const student = store.students.find((item) => item.id === studentId);
                Object.entries(days).forEach(([dayIndex, status]) => {
                    if (!STATE_INFO[status]) return;
                    rows.push([match[1], MONTHS.find((month) => month.value === match[2])?.label || match[2], `Semana ${match[3]}`, courseNames.get(student?.courseId) || student?.courseId || "Curso archivado", student?.name || "Alumno archivado", student?.email || studentId, DAYS[Number(dayIndex)] || "", STATE_INFO[status].label]);
                });
            });
        });
        return rows;
    }

    function downloadExcel() {
        const csv = exportRows().map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\r\n");
        const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `asistencia-jme-${new Date().getFullYear()}.csv`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }

    function printFullReport(rows = exportRows(), reportTitle = "Historial completo de asistencia") {
        const report = document.createElement("section");
        report.className = "att-print-report";
        const title = document.createElement("h1");
        title.textContent = `PORTAL EDUCATIVO JME N°1 · ${reportTitle}`;
        const date = document.createElement("p");
        date.textContent = `Generado el ${new Intl.DateTimeFormat("es-AR", { dateStyle: "long" }).format(new Date())}`;
        const table = document.createElement("table");
        rows.forEach((values, index) => {
            const row = document.createElement("tr");
            values.forEach((value) => {
                const cell = document.createElement(index === 0 ? "th" : "td");
                cell.textContent = String(value);
                row.append(cell);
            });
            table.append(row);
        });
        report.append(title, date, table);
        document.body.append(report);
        document.body.classList.add("att-printing");
        const cleanup = () => {
            report.remove();
            document.body.classList.remove("att-printing");
        };
        window.addEventListener("afterprint", cleanup, { once: true });
        window.print();
        window.setTimeout(cleanup, 30000);
    }

    function printWeekReport(root) {
        const selectedCourse = root.dataset.courseId || root.dataset.selectedCourse || "todos";
        const course = (window.JMEAttendanceGetCourses?.() || []).find((item) => item.id === selectedCourse);
        const rows = exportRows();
        const filteredRows = [rows[0], ...rows.slice(1).filter((row) => row[0] === root.dataset.year
            && row[1] === (MONTHS.find((month) => month.value === root.dataset.month)?.label || root.dataset.month)
            && row[2] === `Semana ${root.dataset.week}`
            && (selectedCourse === "todos" || row[3] === course?.name))];
        const monthName = MONTHS.find((month) => month.value === root.dataset.month)?.label || root.dataset.month;
        printFullReport(filteredRows, `Reporte semanal · ${course?.name || "Todos los cursos"} · ${root.dataset.year} · ${monthName} · Semana ${root.dataset.week}`);
    }

    function renderStudentProfile() {
        const profile = document.querySelector("[data-student-profile]");
        if (!profile) return;
        const params = new URLSearchParams(window.location.search);
        const studentId = params.get("alumno");
        const courseId = params.get("curso");
        const store = readStore();
        const student = store.students.find((item) => item.id === studentId && item.courseId === courseId);
        if (!student) {
            profile.replaceChildren();
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = "No se encontró el alumno solicitado.";
            profile.append(empty);
            return;
        }
        const courseName = window.JMEAttendanceGetCourses?.().find((course) => course.id === student.courseId)?.name || student.courseId;
        const annual = countStates(store.records, store.students, student.courseId, new Date().getFullYear(), student.id);
        profile.replaceChildren();
        const heading = document.createElement("div");
        heading.className = "att-profile-head";
        const name = document.createElement("h1");
        name.textContent = student.name;
        const course = document.createElement("p");
        course.textContent = `${courseName} · ${student.email}`;
        const percent = document.createElement("strong");
        percent.className = "att-profile-percent";
        percent.textContent = formatPercent(getPercent(annual));
        const percentLabel = document.createElement("span");
        percentLabel.textContent = "Asistencia anual";
        heading.append(name, course, percent, percentLabel);
        profile.append(heading);
        const stats = document.createElement("div");
        stats.className = "att-stats-grid att-profile-stats";
        [["🟢 Presentes", annual.present], ["🟡 Tardanzas", annual.late], ["🔴 Ausencias", annual.absent], ["🔵 Justificadas", annual.excused], ["🟣 Feriados", annual.holiday]].forEach(([label, count]) => {
            const card = document.createElement("article");
            card.className = "att-stat stat-blue";
            card.append(document.createTextNode(label));
            const value = document.createElement("strong");
            value.className = "att-stat-value";
            value.textContent = String(count);
            card.append(value);
            stats.append(card);
        });
        profile.append(stats);
        const history = document.createElement("div");
        history.className = "table-wrap att-table-wrap";
        const table = document.createElement("table");
        table.className = "data-table";
        const head = document.createElement("thead");
        const header = document.createElement("tr");
        ["Mes", "Semana", "Día", "Estado"].forEach((label) => {
            const th = document.createElement("th");
            th.textContent = label;
            header.append(th);
        });
        head.append(header);
        const body = document.createElement("tbody");
        Object.entries(store.records).sort(([left], [right]) => left.localeCompare(right)).forEach(([key, records]) => {
            const statusByDay = records[student.id];
            const match = key.match(/^(\d{4})-(\d{2})-w(\d)$/);
            if (!statusByDay || !match) return;
            Object.entries(statusByDay).forEach(([day, status]) => {
                const row = document.createElement("tr");
                [MONTHS.find((month) => month.value === match[2])?.label || match[2], `Semana ${match[3]}`, DAYS[Number(day)], STATE_INFO[status]?.label || ""].forEach((value) => {
                    const td = document.createElement("td");
                    td.textContent = value;
                    row.append(td);
                });
                body.append(row);
            });
        });
        table.append(head, body);
        history.append(table);
        profile.append(history);
    }

    function initAttendance() {
        subscribeAttendanceToCloud();
        document.querySelectorAll("[data-attendance-app]").forEach((root) => {
            const period = getInitialPeriod();
            root.dataset.year ||= String(period.year);
            root.dataset.month ||= period.month;
            root.dataset.week ||= String(period.week);
            renderAttendanceApp(root);
        });
        renderStudentProfile();

        document.addEventListener("change", (event) => {
            const filter = event.target.closest("[data-att-filter]");
            if (!filter) return;
            const root = filter.closest("[data-attendance-app]");
            if (!root) return;
            if (filter.dataset.attFilter === "course") root.dataset.selectedCourse = filter.value;
            if (filter.dataset.attFilter === "year") root.dataset.year = filter.value;
            if (filter.dataset.attFilter === "month") root.dataset.month = filter.value;
            if (filter.dataset.attFilter === "student") root.dataset.studentFilter = filter.value;
            renderAttendanceApp(root);
        });
        document.addEventListener("input", (event) => {
            const filter = event.target.closest("[data-att-filter='search']");
            if (!filter) return;
            const root = filter.closest("[data-attendance-app]");
            if (!root) return;
            root.dataset.search = filter.value;
            const position = filter.selectionStart;
            renderAttendanceApp(root);
            const nextInput = root.querySelector("[data-att-filter='search']");
            nextInput?.focus();
            nextInput?.setSelectionRange(position, position);
        });
        document.addEventListener("click", (event) => {
            const action = event.target.closest("[data-att-action]");
            if (!action) return;
            const root = action.closest("[data-attendance-app]");
            const role = root ? getRole(root) : "student";
            if (action.dataset.attAction === "open-courses" && root) {
                root.dataset.attendanceStep = "courses";
                renderAttendanceApp(root);
            } else if (action.dataset.attAction === "back-to-intro" && root) {
                delete root.dataset.attendanceStep;
                renderAttendanceApp(root);
            } else if (action.dataset.attAction === "select-course" && root) {
                root.dataset.courseId = action.dataset.courseId;
                root.dataset.selectedCourse = action.dataset.courseId;
                delete root.dataset.attendanceStep;
                delete root.dataset.attendanceView;
                renderAttendanceApp(root);
            } else if (action.dataset.attAction === "change-course" && root) {
                delete root.dataset.courseId;
                delete root.dataset.attendanceView;
                root.dataset.attendanceStep = "courses";
                renderAttendanceApp(root);
            } else if (action.dataset.attAction === "show-roster" && root) {
                root.dataset.attendanceView = "roster";
                renderAttendanceApp(root);
            } else if (action.dataset.attAction === "show-attendance" && root) {
                delete root.dataset.attendanceView;
                renderAttendanceApp(root);
            } else if (action.dataset.attAction === "select-week" && root) {
                root.dataset.week = action.dataset.week;
                renderAttendanceApp(root);
            } else if (action.dataset.attAction === "cycle-status" && root && canEdit(role)) {
                cycleStatus(root, action.dataset.studentId, Number(action.dataset.day));
            } else if (action.dataset.attAction === "holiday-day" && root && canEdit(role)) {
                markDayHoliday(root, Number(action.dataset.day));
            } else if (action.dataset.attAction === "export-pdf" && canExport(role)) {
                printFullReport();
            } else if (action.dataset.attAction === "export-excel" && canExport(role)) {
                downloadExcel();
            } else if (action.dataset.attAction === "export-week" && role === "preceptor" && root) {
                printWeekReport(root);
            } else if (action.dataset.attAction === "edit-student" && root && canManageStudents(role)) {
                editStudent(root, action.dataset.studentId);
            } else if (action.dataset.attAction === "delete-student" && canManageStudents(role)) {
                deleteStudent(action.dataset.studentId);
            }
        });
        document.addEventListener("submit", (event) => {
            const form = event.target.closest("[data-att-student-form]");
            if (!form) return;
            event.preventDefault();
            const root = form.closest("[data-attendance-app]");
            if (!root || !canManageStudents(getRole(root))) return;
            if (!form.reportValidity()) return;
            handleStudentSubmit(form).catch((error) => window.JMEFirebase?.reportError(error));
        });
    }

    document.addEventListener("DOMContentLoaded", initAttendance);
})();