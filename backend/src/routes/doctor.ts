import { Hono } from "hono";
import { Prisma, PrismaClient } from "@prisma/client/edge";
import { withAccelerate } from "@prisma/extension-accelerate";
import { sign, verify } from "hono/jwt";
import { appointmentUpdateSchema, availabilitySchema, signinSchema, signupSchema } from "../utils/doctorType";
import { formatDate } from "../utils/userType";
import axios from "axios";

export const doctorRouter = new Hono<{
    Bindings:{
        DATABASE_URL: string
        JWT_SECRET: string
        SENDGRID_API_KEY: string
    }, Variables: {
        doctorId: string
        role: string
    }
}>();

doctorRouter.post("/signup", async(c) => {
    const prisma  = new PrismaClient({
        datasourceUrl: c.env.DATABASE_URL
    }).$extends(withAccelerate());
    const body = await c.req.json();
    const correctSignUpBody = signupSchema.safeParse(body);

    if(!correctSignUpBody.success){
        const errorMessage = correctSignUpBody.error.errors.map((error) => error.message);
        c.status(400);
        return c.json({
            message: errorMessage
        })
    }

    try {
        const doctorExists = await prisma.doctor.findUnique({
            where:{
                email: body.email
            }
        });

        if (doctorExists) {
            c.status(400);
            return c.json({
                message: "Email already in use"
            })
        }

        const doctor = await prisma.doctor.create({
            data:{
                email: correctSignUpBody.data.email,
                name: correctSignUpBody.data.name,
                password: correctSignUpBody.data.password,
                specialization: correctSignUpBody.data.specialization
            }
        })

        const token = await sign({
            id: doctor.id
        }, c.env.JWT_SECRET);

        c.status(200);
        return c.json({
            message: "Sign up succesfull",
            token: token
        })
    } catch (e) {
        c.status(500);
        return c.json({
            message: "Internal server error"
        })
    }
})


doctorRouter.post("/signin", async(c) => {
    const prisma  = new  PrismaClient({
        datasourceUrl: c.env.DATABASE_URL
    }).$extends(withAccelerate());

    const body = await c.req.json();
    const correctSignInBody = signinSchema.safeParse(body);

    if (!correctSignInBody.success) {
        const errorMessage = correctSignInBody.error.errors.map((error) => error.message);
        c.status(400);
        return c.json({
            message: errorMessage
        })
    }

    try {
        const doctor = await prisma.doctor.findUnique({
            where: {
                email: correctSignInBody.data.email,
                password: correctSignInBody.data.password
            }
        });

        if (!doctor) {
            c.status(400);
            return c.json({
                message: "Invalid email or password. Please create an account"
            })
        }

        const token = await sign({
            id: doctor.id,
            role: doctor.role
        }, c.env.JWT_SECRET);

        c.status(200);
        return c.json({
            message: "Signed in successfully",
            token: token,
            doctor: {
                email: doctor.email,
                name: doctor.name,
                specialization: doctor.specialization,
                createdAt: formatDate(doctor.createdAt),
                updatedAt: formatDate(doctor.updatedAt),
            },
        })
    } catch (e) {
        c.status(500);
        return c.json({
            message: "Internal server error"
        })
    }
})

doctorRouter.use("/*", async(c, next) => {
    const authHeader = c.req.header("Authorization") || "";
        const [scheme, token] = authHeader.split(" ");
        if (scheme !== 'Bearer' || !token) {
            c.status(401);
            return c.json({
                message: "Unauthorized"
            })
        }
    
        try {
            const decode = await verify(token, c.env.JWT_SECRET);
            if (decode) {
                c.set('doctorId', String(decode.id));
                c.set("role", String(decode.role));
                await next();
            } else {
                c.status(401);
                return c.json({
                    message: "You are not logged in. Please log in to continue"
                })
            }
        } catch (e) {
            c.status(401);
            return c.json({
                message: "You are not logged in. Please log in to continue"
            })
        }
})

doctorRouter.get("/profile", async (c) => {
    const prisma = new PrismaClient({
        datasourceUrl: c.env.DATABASE_URL
    }).$extends(withAccelerate());

    // @ts-ignore
    const doctorId = c.get("doctorId");

    try {
        const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });

        if (!doctor) {
            c.status(404);
            return c.json({ message: "Doctor not found. Please login first" });
        }

        c.status(200);
        return c.json({
            message: "Doctor profile found successfully",
            doctor: {
                email: doctor.email,
                name: doctor.name,
                specialization: doctor.specialization,
                createdAt: formatDate(doctor.createdAt),
                updatedAt: formatDate(doctor.updatedAt),
            },
        });
    } catch (e) {
        console.error(e);
        c.status(500);
        return c.json({ message: "Internal Server Error" });
    }
});

doctorRouter.post("/availability", async (c) => {
    const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL }).$extends(withAccelerate());
    const doctorId = c.get("doctorId");
    const body = await c.req.json();

    console.log("🔹 Received request for doctor availability update");
    console.log("🔹 Extracted doctorId:", doctorId);
    console.log("🔹 Received body:", body);

    const validSlots = availabilitySchema.safeParse(body);
    if (!validSlots.success) {
        console.error("❌ Validation failed:", validSlots.error.errors);
        c.status(400);
        return c.json({ message: validSlots.error.errors.map(e => e.message) });
    }

    const inputDate = new Date(body.date);
    console.log("🔹 Converted input date:", inputDate);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (inputDate < today) {
        console.warn("⚠️ Attempt to set availability for past date:", inputDate);
        c.status(400);
        return c.json({ message: "You cannot set availability for a past date." });
    }

    try {
        console.log("🔍 Checking if doctor exists...");
        const existingDoctor = await prisma.doctor.findUnique({ where: { id: doctorId } });

        if (!existingDoctor) {
            console.error("❌ Doctor not found:", doctorId);
            c.status(404);
            return c.json({ message: "Doctor not found" });
        }

        console.log("✅ Doctor exists, proceeding to check availability...");

        console.log("🔍 Fetching booked appointments...");
        const bookedAppointments = await prisma.appointment.findMany({
            where: { doctorId, date: inputDate },
            select: { slot: true }
        });

        const bookedSlots = bookedAppointments.map(app => app.slot);
        console.log("⛔ Booked slots:", bookedSlots);

        const existingAvailability = await prisma.doctorAvailability.findUnique({
            where: { doctorId_date: { doctorId, date: inputDate } }
        }) as any;

        console.log("🟢 Existing availability:", existingAvailability);

        let mergedSlots = existingAvailability ? [...existingAvailability.slots, ...body.slots] : body.slots;

        console.log("🔄 Merging slots...", mergedSlots);

        mergedSlots = mergedSlots.filter((slot : any) => !bookedSlots.includes(slot.start));

        console.log("✅ Filtered available slots (removed booked ones):", mergedSlots);

        mergedSlots.sort((a: any, b: any) => a.start.localeCompare(b.start));

        for (let i = 0; i < mergedSlots.length - 1; i++) {
            let current = mergedSlots[i];
            let next = mergedSlots[i + 1];

            if (next.start < current.end) {
                console.warn("⚠️ Overlapping slots detected:", current, next);
                c.status(400);
                return c.json({ message: `Overlapping slots detected: ${current.start}-${current.end} & ${next.start}-${next.end}` });
            }
        }

        console.log("✅ No overlapping slots detected, proceeding...");

        let availability;
        if (existingAvailability) {
            console.log("🔄 Updating existing availability...");
            availability = await prisma.doctorAvailability.update({
                where: { doctorId_date: { doctorId, date: inputDate } },
                data: { slots: mergedSlots },
            });
        } else {
            console.log("🆕 Creating new availability...");
            availability = await prisma.doctorAvailability.create({
                data: { doctorId, date: inputDate, slots: mergedSlots },
            });
        }

        console.log("✅ Availability operation successful:", availability);

        c.status(200);
        return c.json({ message: "Availability set successfully", availability });
    } catch (e) {
        console.error("❌ Error in availability operation:", e);

        if (e instanceof Prisma.PrismaClientKnownRequestError) {
            console.error("📛 Prisma Error Code:", e.code);
            console.error("📛 Prisma Error Meta:", e.meta);
        }

        c.status(500);
        return c.json({ message: "Internal Server Error", error: e });
    }
});

doctorRouter.delete("/availability", async (c) => {
    const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL }).$extends(withAccelerate());
    const doctorId = c.get("doctorId");
    const body = await c.req.json();

    console.log("🗑️ Received request to delete slots for doctor:", doctorId);
    console.log("🗑️ Request body:", body);

    const { date, slots } = body;

    if (!date || !Array.isArray(slots) || slots.length === 0) {
        c.status(400);
        return c.json({ message: "Invalid request. Provide a valid date and slots array." });
    }

    const inputDate = new Date(date);
    console.log("🔹 Converted input date:", inputDate);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (inputDate < today) {
        console.warn("⚠️ Cannot delete past slots:", inputDate);
        c.status(400);
        return c.json({ message: "You cannot delete slots for a past date." });
    }

    try {
        console.log("🔍 Checking if doctor exists...");
        const existingDoctor = await prisma.doctor.findUnique({
            where: { id: doctorId }
        });

        if (!existingDoctor) {
            console.error("❌ Doctor not found:", doctorId);
            c.status(404);
            return c.json({ message: "Doctor not found" });
        }

        console.log("✅ Doctor found. Checking existing availability...");
        
        const existingAvailability = await prisma.doctorAvailability.findUnique({
            where: {
                doctorId_date:{
                    doctorId,
                    date: inputDate
                }
            }
        }) as any;

        if (!existingAvailability) {
            console.warn("⚠️ No availability found for this date:", inputDate);
            c.status(404);
            return c.json({ message: "No availability found for this date." });
        }

        console.log("🟢 Existing slots:", existingAvailability.slots);

        const updatedSlots = existingAvailability.slots.filter(
            // @ts-ignore
            (slot) => !slots.some((delSlot) => delSlot.start === slot.start && delSlot.end === slot.end)
        );

        if (updatedSlots.length === existingAvailability.slots.length) {
            console.warn("⚠️ No matching slots found to delete:", slots);
            c.status(400);
            return c.json({ message: "No matching slots found to delete." });
        }

        console.log("🗑️ Updated slots after deletion:", updatedSlots);

        if (updatedSlots.length === 0) {
            console.log("🗑️ No slots left, deleting the availability record...");
            await prisma.doctorAvailability.delete({
                where: { doctorId_date: { doctorId, date: inputDate } }
            });
        } else {
            console.log("Updating availability record...");
            await prisma.doctorAvailability.update({
                where: { doctorId_date: { doctorId, date: inputDate } },
                data: { slots: updatedSlots }
            });
        }

        console.log("✅ Slots deleted successfully.");
        c.status(200);
        return c.json({ message: "Slots deleted successfully." });

    } catch (e) {
        console.error("❌ Error in deleting slots:", e);
        c.status(500);
        return c.json({ message: "Internal Server Error", error: e });
    }
});

doctorRouter.get("/availability", async (c) => {
    const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL }).$extends(withAccelerate());
    const doctorId = c.get("doctorId");

    console.log(`🔍 Fetching all availability slots for Doctor ID: ${doctorId}`);

    try {
        const availability = await prisma.doctorAvailability.findMany({
            where: { doctorId },
            select: { date: true, slots: true },
        });

        if (!availability || availability.length === 0) {
            console.log("❌ No availability found.");
            c.status(404);
            return c.json({ message: "No availability slots found." });
        }

        console.log("🟢 Retrieved availability slots:", availability);

        c.status(200);
        return c.json({ message: "Availability slots retrieved successfully", availability });
    } catch (e) {
        console.error("❌ Error fetching availability slots:", e);
        c.status(500);
        return c.json({ message: "Internal Server Error", error: e });
    }
});


doctorRouter.get("/appointments", async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL }).$extends(withAccelerate());
  const doctorId = c.get("doctorId");

  try {
    const appointments = await prisma.appointment.findMany({
      where: { doctorId },
      select: {
        id: true,
        status: true,
        date: true,
        slot: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!appointments.length) {
      c.status(404);
      return c.json({ message: "No appointments found for this doctor." });
    }

    const response = appointments.map((appointment) => ({
      id: appointment.id,
      status: appointment.status,
      date: appointment.date.toISOString().split("T")[0],
      slot: appointment.slot,
      patient: appointment.user.name
    }));

    c.status(200);
    return c.json({
      message: "Appointments retrieved successfully",
      appointments: response
    });
  } catch (e) {
    console.error("❌ Error:", e);
    c.status(500);
    return c.json({ message: "Internal Server Error" });
  }
});


doctorRouter.patch("/appointments/update-status", async (c) => {
    const prisma = new PrismaClient({
        datasourceUrl: c.env.DATABASE_URL
    }).$extends(withAccelerate());

    const doctorId = c.get("doctorId");

    const body = await c.req.json();
    const validation = appointmentUpdateSchema.safeParse(body);

    if (!validation.success) {
        c.status(400);
        return c.json({ message: validation.error.errors.map(e => e.message) });
    }

    const { appointmentId, stat } = body;

    try {
        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
                user: true,
                doctor: true
            }
        });

        if (!appointment) {
            c.status(404);
            return c.json({ message: "Appointment not found." });
        }

        if (appointment.doctorId !== doctorId) {
            c.status(403);
            return c.json({ message: "Unauthorized: You can only update your own appointments." });
        }

        const updatedAppointment = await prisma.appointment.update({
            where: { id: appointmentId },
            data: {
                status: stat
            }
        });

        // Send email notification to user
        try {
            const response = await axios.post('https://api.sendgrid.com/v3/mail/send', {
                personalizations: [{ to: [{ email: appointment.user.email }] }],
                from: { email: 'equihealthh@gmail.com', name: 'EquiHealth' },
                subject: `Appointment Status Updated - ${stat}`,
                content: [{ 
                    type: 'text/html', 
                    value: `<p>Hi ${appointment.user.name},</p>
                    <p>Your appointment with Dr. ${appointment.doctor.name} on <strong>${appointment.date.toDateString()}</strong> at <strong>${appointment.slot}</strong> has been <strong>${stat}</strong>.</p>
                    ${stat === 'CONFIRMED' ? '<p>Please be ready for your appointment at the scheduled time.</p>' : ''}
                    ${stat === 'CANCELLED' ? '<p>If you would like to reschedule, please book a new appointment.</p>' : ''}
                    <p>– EquiHealth Team</p>`
                }]
            }, {
                headers: {
                    'Authorization': `Bearer ${c.env.SENDGRID_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 10000 // 10 second timeout
            });

            if (response.status === 202) {
                console.log(`Status update email sent successfully to ${appointment.user.email}`);
            }
        } catch (emailError) {
            console.error('Failed to send status update email:', emailError);
            // Don't fail the appointment update if email fails
        }

        c.status(200);
        return c.json({ 
            message: "Appointment status updated successfully.", 
            appointment: updatedAppointment,
            emailSent: true
        });
    } catch (error) {
        console.error("❌ Error updating appointment status:", error);
        c.status(500);
        return c.json({ message: "Internal Server Error" });
    }
});

doctorRouter.get("/patients", async (c) => {
    const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL }).$extends(withAccelerate());
    const doctorId = c.get("doctorId");
  
    try {
      const appointments = await prisma.appointment.findMany({
        where: { doctorId },
        orderBy: { date: 'asc' },
        include: {
          user: true
        }
      });
  
      const uniqueMap = new Map<string, typeof appointments[0]>();
      for (const a of appointments) {
        if (!uniqueMap.has(a.userId)) {
          uniqueMap.set(a.userId, a);
        }
      }
  
      const patients = Array.from(uniqueMap.values()).map((a) => {
        const bmi = (a.user.weight / ((a.user.height / 100) ** 2)).toFixed(1); // height in cm to m
        const nextAppointment = appointments.find(appt => appt.userId === a.userId && appt.date > new Date());
  
        return {
          id: a.user.id,
          name: a.user.name,
          age: a.user.age,
          bmi,
          medicalHistory: ['Diabetes'], 
          nextAppointment: nextAppointment?.date.toDateString() || "No upcoming"
        };
      });
  
      return c.json({
        message: "Patients fetched successfully",
        patients
      });
    } catch (e) {
      console.error("❌ Error fetching patients:", e);
      return c.json({ message: "Internal Server Error" }, 500);
    }
  });
  